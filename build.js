const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// Configure directories
const ROOT_DIR = __dirname;
const TEMPLATE_DIR = path.join(ROOT_DIR, 'templates');
const OUTPUT_DIR = path.join(ROOT_DIR, '_site');
const NOTES_DIR = path.join(ROOT_DIR, 'notes');

// Exclude list for note scanning
const EXCLUDE_FILES = new Set([
  'index.html', 'package.json', 'package-lock.json', 'build.js', 'README.md'
]);
const EXCLUDE_DIRS = new Set([
  '_site', 'node_modules', '.git', '.github', 'templates', 'artifacts', 'scratch'
]);

// Helper to generate consistent slug IDs from headings
function slugify(text) {
  // Unescape HTML entities (e.g. &amp; -> &) in case marked pre-escapes them
  const unescaped = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  return unescaped.toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove special characters except spaces, hyphens, alphanumeric
    .trim()
    .replace(/\s/g, '-');     // replace spaces with hyphens (preserves double spaces as double hyphens, matching GitHub behavior)
}

// Initialize Marked with a custom heading renderer to inject IDs for Table of Contents / ScrollSpy
const renderer = new marked.Renderer();
renderer.heading = function(text, depth, raw) {
  const id = slugify(text);
  return `<h${depth} id="${id}">${text}</h${depth}>`;
};

// Render tables with wrapper for horizontal scrolling on narrow screens
renderer.table = function(header, body) {
  return `<div class="table-wrapper">
    <table>
      <thead>${header}</thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
};

// Override link parsing to automatically rewrite .md targets to .html
renderer.link = function(href, title, text) {
  let cleanHref = href;
  if (href.endsWith('.md')) {
    cleanHref = href.substring(0, href.length - 3) + '.html';
  } else if (href.includes('.md#')) {
    cleanHref = href.replace('.md#', '.html#');
  }
  return `<a href="${cleanHref}"${title ? ` title="${title}"` : ''}>${text}</a>`;
};

marked.setOptions({ renderer });

// Utility: Ensure a directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Utility: Clean output directory
function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

// Step 1: Scan for all note files (.md and .html) recursively
function scanNotes(dir, allNotes = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.has(file)) {
        scanNotes(filePath, allNotes);
      }
    } else {
      const ext = path.extname(file).toLowerCase();
      if ((ext === '.md' || ext === '.html') && !EXCLUDE_FILES.has(file)) {
        allNotes.push({
          fullPath: filePath,
          relativePath: path.relative(ROOT_DIR, filePath),
          filename: file,
          ext: ext
        });
      }
    }
  }
  return allNotes;
}

// Step 2: Extract Metadata from Note Content
function parseMetadata(note) {
  const content = fs.readFileSync(note.fullPath, 'utf-8');
  let title = '';
  let description = '';
  let category = '';
  let tags = [];

  // Default slug creation
  const baseName = path.basename(note.filename, note.ext);
  const slug = baseName.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
  const outputFilename = `${slug}.html`;

  // Parse Markdown
  if (note.ext === '.md') {
    // Try to parse YAML Frontmatter (e.g. --- key: val ---)
    const frontmatterRegex = /^---\r?\n([\s\S]+?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    let mainContent = content;

    if (match) {
      mainContent = content.substring(match[0].length);
      const fmText = match[1];
      
      // Basic YAML Key-Value Parser
      fmText.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join(':').trim();
          
          if (key === 'title') title = val.replace(/^["']|["']$/g, '');
          if (key === 'description') description = val.replace(/^["']|["']$/g, '');
          if (key === 'category') category = val.replace(/^["']|["']$/g, '');
          if (key === 'tags') {
            tags = val.replace(/[\[\]]/g, '').split(',').map(t => t.trim());
          }
        }
      });
    }

    // Fallback Title: First H1 (# Title)
    if (!title) {
      const h1Match = mainContent.match(/^#\s+(.+)$/m);
      title = h1Match ? h1Match[1].trim() : baseName;
    }

    // Fallback Excerpt: First non-blank line that isn't a heading/list/table
    if (!description) {
      const lines = mainContent.split('\n');
      for (const line of lines) {
        const clean = line.trim();
        if (clean && !clean.startsWith('#') && !clean.startsWith('-') && !clean.startsWith('*') && !clean.startsWith('|') && !clean.startsWith('>')) {
          description = clean.substring(0, 150) + (clean.length > 150 ? '...' : '');
          break;
        }
      }
    }
  } 
  // Parse HTML
  else {
    // Title matching
    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    title = titleMatch ? titleMatch[1].trim() : baseName;

    // First paragraph matching
    const pMatch = content.match(/<p>(.*?)<\/p>/i);
    if (pMatch) {
      description = pMatch[1].replace(/<[^>]+>/g, '').substring(0, 150);
      if (pMatch[1].length > 150) description += '...';
    }
  }

  // Fallback defaults
  if (!title) title = baseName;
  if (!description) description = `Read the detailed technical guide on ${title}.`;

  // Semantic category categorization based on keywords
  if (!category) {
    const textToCheck = (title + ' ' + description + ' ' + note.filename).toLowerCase();
    if (textToCheck.includes('shopify')) {
      category = 'Shopify';
    } else if (textToCheck.includes('grpc') || textToCheck.includes('rpc') || textToCheck.includes('protocol buffer') || textToCheck.includes('protobuf')) {
      category = 'gRPC & Microservices';
    } else if (textToCheck.includes('graphql')) {
      category = 'GraphQL';
    } else if (textToCheck.includes('sso') || textToCheck.includes('saml') || textToCheck.includes('auth') || textToCheck.includes('oauth')) {
      category = 'Security & Auth';
    } else if (textToCheck.includes('scheduler') || textToCheck.includes('quartz')) {
      category = 'Infrastructure';
    } else if (textToCheck.includes('webhook')) {
      category = 'Webhooks';
    } else if (textToCheck.includes('sftp') || textToCheck.includes('ftp') || textToCheck.includes('callbackurl')) {
      category = 'Integrations';
    } else {
      category = 'Core Concepts';
    }
  }

  // Ensure category is in tags list
  if (!tags.includes(category)) tags.push(category);

  return {
    id: slug,
    title,
    description,
    category,
    tags,
    slug,
    outputFilename,
    originalContent: content,
    ext: note.ext,
    filename: note.filename,
    relativePath: note.relativePath
  };
}

// Step 3: Generate Table of Contents (ToC) from Markdown
function generateToC(markdownText) {
  // Regex to extract ## and ### headings
  const headingRegex = /^(##|###)\s+(.+)$/gm;
  let match;
  let tocHtml = '';

  while ((match = headingRegex.exec(markdownText)) !== null) {
    const depth = match[1] === '##' ? 2 : 3;
    const text = match[2].trim().replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Strip markdown links in headings
    const id = slugify(text);

    tocHtml += `<li class="toc-item depth-${depth}"><a href="#${id}" class="toc-link">${text}</a></li>\n`;
  }

  return tocHtml;
}

// Step 4: Generate Sidebar Navigation grouped by Category
function generateSidebar(allNotes, activeSlug) {
  // Group notes by category
  const groups = {};
  allNotes.forEach(note => {
    if (!groups[note.category]) groups[note.category] = [];
    groups[note.category].push(note);
  });

  let sidebarHtml = '';

  // Render each category group
  Object.keys(groups).sort().forEach(category => {
    sidebarHtml += `<div class="nav-section">
      <div class="nav-label">${category}</div>\n`;
    
    groups[category].sort((a, b) => a.title.localeCompare(b.title)).forEach(note => {
      const activeClass = note.slug === activeSlug ? ' active' : '';
      
      // Assign simple emoji icons based on categories
      let icon = '📄';
      if (category === 'Shopify') icon = '🛍️';
      else if (category.includes('gRPC')) icon = '⚡';
      else if (category.includes('GraphQL')) icon = '⚛️';
      else if (category.includes('Security')) icon = '🛡️';
      else if (category.includes('Infrastructure')) icon = '⚙️';
      else if (category.includes('Webhooks')) icon = '🔔';
      else if (category.includes('Integrations')) icon = '🔌';

      sidebarHtml += `<a class="nav-item${activeClass}" href="${note.outputFilename}">
        <span class="nav-item-icon">${icon}</span> ${note.title}
      </a>\n`;
    });

    sidebarHtml += `</div>\n`;
  });

  return sidebarHtml;
}

// Step 5: Render Category Icons for Portal cards
function getCategoryEmoji(category) {
  switch(category) {
    case 'Shopify': return '🛍️';
    case 'gRPC & Microservices': return '⚡';
    case 'GraphQL': return '⚛️';
    case 'Security & Auth': return '🛡️';
    case 'Infrastructure': return '⚙️';
    case 'Webhooks': return '🔔';
    case 'Integrations': return '🔌';
    default: return '📄';
  }
}

// Main Build Execution
function main() {
  console.log('🚀 Starting Wiki Compilation...');
  
  // 1. Ensure Directories exist
  cleanDir(OUTPUT_DIR);
  ensureDir(OUTPUT_DIR);
  
  // 2. Scan notes and build metadata
  const scanned = scanNotes(NOTES_DIR);
  console.log(`🔍 Scanned ${scanned.length} note files.`);
  
  const allNotes = scanned.map(note => parseMetadata(note));

  // 3. Compile individual note pages
  const noteTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'note.html'), 'utf-8');

  allNotes.forEach(note => {
    // If it's a Markdown file, compile it using marked
    if (note.ext === '.md') {
      console.log(`📝 Compiling Markdown: ${note.relativePath} -> ${note.outputFilename}`);
      
      const parsedHtmlContent = marked.parse(note.originalContent);
      const toc = generateToC(note.originalContent);
      const sidebar = generateSidebar(allNotes, note.slug);

      // Inject into templates
      let renderedPage = noteTemplate
        .replace(/{{NOTE_TITLE}}/g, note.title)
        .replace(/{{THEME_CSS}}/g, 'theme.css')
        .replace(/{{SIDEBAR_NAV}}/g, sidebar)
        .replace(/{{TABLE_OF_CONTENTS}}/g, toc)
        .replace(/{{NOTE_CONTENT}}/g, parsedHtmlContent);

      fs.writeFileSync(path.join(OUTPUT_DIR, note.outputFilename), renderedPage);
    } 
    // If it's an HTML file (e.g. shopify-api-guide.html), keep it as is but patch with float home button!
    else {
      console.log(`🎨 Copying HTML Note: ${note.relativePath} -> ${note.outputFilename}`);
      
      let htmlContent = note.originalContent;
      
      // Inject floating home button badge before </body>
      const floatingButtonHtml = `
  <!-- Floating Portal Badge injected by Wiki Generator -->
  <style>
    .floating-home-btn-injected {
      position: fixed;
      bottom: 2rem;
      left: 2rem;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #4f46e5;
      color: #ffffff !important;
      padding: 10px 18px;
      border-radius: 9999px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: 0.85rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.15), 0 0 20px rgba(79, 70, 229, 0.25);
      z-index: 10000;
      text-decoration: none !important;
      transition: all 0.15s ease-in-out;
    }
    .floating-home-btn-injected:hover {
      transform: translateY(-2px);
      background: #4338ca;
      box-shadow: 0 10px 20px -3px rgba(0, 0, 0, 0.2), 0 0 25px rgba(79, 70, 229, 0.4);
      color: #ffffff !important;
    }
  </style>
  <a href="index.html" class="floating-home-btn-injected">← Back to Portal</a>
  `;
      
      if (htmlContent.includes('</body>')) {
        htmlContent = htmlContent.replace('</body>', `${floatingButtonHtml}\n</body>`);
      } else {
        htmlContent += floatingButtonHtml;
      }
      
      const faviconHtml = `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📝</text></svg>">`;
      if (htmlContent.includes('</head>')) {
        htmlContent = htmlContent.replace('</head>', `  ${faviconHtml}\n</head>`);
      } else {
        htmlContent = faviconHtml + '\n' + htmlContent;
      }
      
      fs.writeFileSync(path.join(OUTPUT_DIR, note.outputFilename), htmlContent);
    }
  });

  // 4. Compile Portal Dashboard Page (index.html)
  console.log('🏡 Building Wiki Portal Dashboard (index.html)...');
  const portalTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, 'portal.html'), 'utf-8');

  // Build grid cards
  let cardsHtml = '';
  allNotes.forEach(note => {
    const emoji = getCategoryEmoji(note.category);
    cardsHtml += `
    <a class="note-card" href="${note.outputFilename}" data-id="${note.id}">
      <div class="card-top">
        <div class="card-icon">${emoji}</div>
        <div class="card-badge">${note.category}</div>
      </div>
      <h3>${note.title}</h3>
      <p>${note.description}</p>
      <div class="card-footer">
        <span>${note.ext === '.md' ? 'Markdown' : 'HTML'} note</span>
        <span class="card-read-more">Read Note <span>→</span></span>
      </div>
    </a>\n`;
  });

  // Build filters buttons
  const uniqueCategories = [...new Set(allNotes.map(n => n.category))].sort();
  let filtersHtml = '';
  uniqueCategories.forEach(category => {
    filtersHtml += `<button class="filter-btn" data-filter="${category}">${category}</button>\n`;
  });

  // Build Client Search JSON Index
  const searchIndex = allNotes.map(n => ({
    id: n.id,
    title: n.title,
    description: n.description,
    category: n.category,
    tags: n.tags
  }));

  let renderedPortal = portalTemplate
    .replace(/{{THEME_CSS}}/g, 'theme.css')
    .replace(/{{NOTE_TABS}}/g, filtersHtml)
    .replace(/{{NOTE_CARDS}}/g, cardsHtml)
    .replace(/{{NOTE_JSON}}/g, JSON.stringify(searchIndex));

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), renderedPortal);

  // 5. Copy static assets (theme.css, images, schemas, svgs)
  console.log('📁 Copying stylesheets and media assets...');
  
  // Theme CSS
  fs.copyFileSync(
    path.join(TEMPLATE_DIR, 'theme.css'), 
    path.join(OUTPUT_DIR, 'theme.css')
  );

  // Copy PNGs and SVGs from the notes folder so links inside notes work
  if (fs.existsSync(NOTES_DIR)) {
    const filesInNotes = fs.readdirSync(NOTES_DIR);
    filesInNotes.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.png' || ext === '.svg' || ext === '.jpg' || ext === '.jpeg') {
        console.log(`   └─ Copying asset: ${file}`);
        fs.copyFileSync(
          path.join(NOTES_DIR, file),
          path.join(OUTPUT_DIR, file)
        );
      }
    });
  }

  // Copy CNAME from repository root for custom domain routing
  const cnamePath = path.join(ROOT_DIR, 'CNAME');
  if (fs.existsSync(cnamePath)) {
    console.log(`   └─ Copying CNAME configuration`);
    fs.copyFileSync(cnamePath, path.join(OUTPUT_DIR, 'CNAME'));
  }

  console.log('✨ Wiki Compilation Completed Successfully! Build output saved to _site/');
}

// Run if called directly
if (require.main === module) {
  main();
}