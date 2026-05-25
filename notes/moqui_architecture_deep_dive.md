# Moqui Framework — Deep-Dive Architecture Walkthrough

> **Who this is for:** Beginners in Moqui who know basic Java/Groovy.
> Every Moqui-specific term is defined on first use. Analogies are used throughout.

---

## Table of Contents

1. [The Big Picture — How Moqui Boots](#1-the-big-picture--how-moqui-boots)
2. [File Types & Their Roles](#2-file-types--their-roles)
3. [XML Processing Pipeline](#3-xml-processing-pipeline)
4. [File Conversion Chain — What Becomes What?](#4-file-conversion-chain--what-becomes-what)
5. [Groovy Processing Pipeline](#5-groovy-processing-pipeline)
6. [Java Compilation & Integration](#6-java-compilation--integration)
7. [Service Execution Lifecycle](#7-service-execution-lifecycle)
8. [Screen Rendering Lifecycle](#8-screen-rendering-lifecycle)
9. [Summary Table](#9-summary-table)

---

## 1. The Big Picture — How Moqui Boots

**Analogy:** Think of Moqui like a restaurant. When the restaurant opens (boot), the kitchen is stocked (XML definitions loaded), menus are printed (screens cached), and waiters are briefed (facades initialized). Only when a customer arrives (HTTP request) does the actual cooking start.

### Boot sequence in `ExecutionContextFactoryImpl` (ECFI)

`ExecutionContextFactoryImpl` (`ecfi`) is the single God-object that owns everything. Its constructor (lines 161–246 in your local source) runs this sequence:

```
1. Read MoquiInit.properties   → find runtime/ directory and conf file path
2. Parse MoquiDefaultConf.xml  → base configuration tree (MNode)
3. initComponents()            → scan component-list, load each component dir
4. initConfig()                → merge component MoquiConf.xml + runtime conf
5. initClassLoader()           → build MClassLoader + GroovyClassLoader
6. new CacheFacadeImpl()       → JCache/Hazelcast cache buckets
7. new ResourceFacadeImpl()    → FTL renderer, Groovy script runner, resource locators
8. new TransactionFacadeImpl() → JTA transaction manager (Bitronix by default)
9. new EntityFacadeImpl()      → entity definitions loaded from all entity/*.xml
10. new ServiceFacadeImpl()    → service runners registered; SECA rules loaded
11. new ScreenFacadeImpl()     → screen caches initialized; FTL widget templates loaded
12. postFacadeInit()           → warm caches, start scheduled job runner
```

**Key term — Facade:** A facade is a single entry-point object that groups related functionality. `EntityFacade` handles all database stuff; `ServiceFacade` handles all service calls; `ScreenFacade` handles all screen rendering.

**Key term — MNode:** Moqui's own lightweight XML node class. It is NOT the standard Java DOM. After parsing, every XML file lives entirely in memory as an `MNode` tree. Think of it as a Java `Map<String, Object>` that can have children.

---

## 2. File Types & Their Roles

| Extension | Purpose | Compiled? | When Processed | Processor Class |
|---|---|---|---|---|
| `*.xml` (entity) | Defines database table structure | No (parsed to MNode) | Startup | `EntityFacadeImpl` |
| `*.xml` (service) | Declares service parameters & actions | Partially* | First call (lazy) | `ServiceFacadeImpl` + `ServiceDefinition` |
| `*.xml` (screen) | Declares a UI screen | Partially* | First request (lazy) | `ScreenFacadeImpl` + `ScreenDefinition` |
| `*.xml` (data) | Seed/demo data records | No | On demand (data load) | `EntityDataLoaderImpl` |
| `*.xml` (secas) | Service Event Condition/Action rules | Parsed to objects | Startup | `ServiceFacadeImpl.loadSecaRulesAll()` |
| `*.groovy` (script) | Standalone script or service logic | Compiled to Class in-memory | First call (lazy, cached) | `GroovyScriptRunner` + `compileGroovy()` |
| `*.java` | Framework internals, ServiceRunner impls | Pre-compiled in build | At build time | Gradle `javac` |
| `*.ftl` | FreeMarker templates for HTML output | Parsed to Template object | First request (cached) | `FtlTemplateRenderer` |
| `*.properties` | Config key-value pairs | No | Startup or on demand | Standard Java `Properties` |
| `MoquiDefaultConf.xml` | Base framework configuration | No (MNode) | Startup | `ExecutionContextFactoryImpl.initBaseConfig()` |
| `MoquiConf.xml` | Per-component config override | No (MNode) | Startup, merged | `ExecutionContextFactoryImpl.initConfig()` |
| `log4j2.xml` | Logging config | No | Startup | Log4J2 `LoggerContext` |

*"Partially" means: the XML is parsed to an MNode once; then the `<actions>` block inside is further compiled to Groovy bytecode on the first call, and that bytecode is cached.

---

## 3. XML Processing Pipeline

### How XML files are loaded

All XML parsing goes through `MNode.parse(ResourceReference)`. This is crucial — Moqui does **not** use standard JAXB or DOM parsers. `MNode` is Moqui's own fast parser (backed by a StAX/SAX-style reader).

**Analogy:** Standard XML parsing is like scanning a 100-page book word by word. `MNode.parse()` is like photocopying it into a dictionary in RAM — fast to look up, never re-read the file.

#### Entity XML

```
entity/*.xml
  └─ parsed by EntityFacadeImpl (startup)
        └─ MNode tree → EntityDefinition object (one per entity)
              ├─ FieldInfo[] (columns) — compiled at startup
              └─ stored in entityDefinitionCache
```

- **Who:** `EntityFacadeImpl` scans every `entity/` directory in every component.
- **When:** Startup, all at once.
- **Result:** `EntityDefinition` objects in the `entity.definition` JCache.
- **Re-read?** No. The cache is permanent unless you explicitly call warmCache again.

#### Service XML

```
service/*.xml
  └─ NOT pre-scanned — loaded lazily on first call
        └─ ServiceFacadeImpl.findServiceNode() → MNode.parse(file)
              └─ ServiceDefinition constructed (MNode + metadata)
                    └─ if <actions> child exists → XmlAction constructed (not yet compiled)
                    └─ stored in serviceLocationCache (JCache)
```

- **Who:** `ServiceFacadeImpl.makeServiceDefinition()` (line 225)
- **When:** First time the service is called; result cached.
- **Re-read?** No — once in the `serviceLocationCache`, it's not re-parsed.

> [!NOTE]
> If `warm-on-start` is enabled in the conf, Moqui calls `ServiceFacadeImpl.warmCache()` at boot, pre-loading all service definitions eagerly.

#### Screen XML

```
screen/*.xml
  └─ Loaded lazily on first request
        └─ ScreenFacadeImpl.makeScreenDefinition() → MNode.parse(file)
              └─ ScreenDefinition constructed
                    ├─ TransitionItem list (URL handlers)
                    ├─ SubscreensItem map (child screens)
                    ├─ <actions> → XmlAction (compiled on first render)
                    └─ stored in screenLocationCache + screenLocationPermCache
```

- **Who:** `ScreenFacadeImpl.getScreenDefinition()` (line 152)
- **Modified file detection:** `ScreenFacadeImpl.makeScreenDefinition()` checks `resourceRef.getLastModified()` against `permSd.screenLoadedTime` — so if you edit a screen file, it auto-reloads on the next request (dev mode).

---

## 4. File Conversion Chain — What Becomes What?

This is the most important section. Here is the precise chain for each file type.

---

### 4a. Entity XML → EntityDefinition

```
entity/MyEntity.xml  (disk file)
  │
  ├─ Trigger: EntityFacadeImpl constructor (startup)
  ├─ Tool: MNode.parse()
  │
  └─► MNode tree (in RAM)
        │
        ├─ Trigger: EntityFacadeImpl.loadAllEntityLocations()
        ├─ Tool: EntityDefinition constructor
        │
        └─► EntityDefinition object (Java object)
              ├─ FieldInfo[] (one per column)
              ├─ fullEntityName, tableName
              └─ stored in: entityDefinitionCache (JCache, permanent)
```

**Original file after conversion?** No longer needed. The MNode cache is cleared after boot (`MNode.clearParsedNodeCache()` is called in `postFacadeInit()`).

---

### 4b. Service XML → ServiceDefinition → XmlAction → Groovy Class

This is the most complex chain. Pay close attention.

```
service/MyServices.xml  (disk file)
  │
  ├─ Trigger: First call to ec.service.sync().name("...").call()
  ├─ Tool: ServiceFacadeImpl.findServiceNode() + MNode.parse()
  │
  └─► MNode (the <service> element node)
        │
        ├─ Trigger: ServiceFacadeImpl.makeServiceDefinition()
        ├─ Tool: new ServiceDefinition(sfi, path, serviceNode)
        │
        └─► ServiceDefinition object
              ├─ verb, noun, path (the service name parts)
              ├─ ParameterInfo[] for in/out parameters
              ├─ serviceType (inline/java/script/entity-auto)
              ├─ serviceRunner (InlineServiceRunner, JavaServiceRunner, etc.)
              │
              └─ IF <actions> block exists:
                    ├─ Trigger: ServiceDefinition constructor (line 174)
                    ├─ Tool: new XmlAction(ecfi, actionsNode, serviceName)
                    │
                    └─► XmlAction object (stores MNode, no Groovy yet)
                          │
                          └─ Trigger: First time InlineServiceRunner.runService() calls xmlAction.run()
                             │
                             ├─ Tool: XmlAction.makeGroovyClass()
                             │   Step 1: XmlAction.getGroovyString()
                             │           → feeds MNode into a FreeMarker template
                             │           → FTL template (XmlActions.groovy.ftl) transforms
                             │             XML action nodes into Groovy source code
                             │
                             │   Step 2: ecfi.compileGroovy(groovySource, className)
                             │           → GroovyClassLoader.parseClass()
                             │           → bytecode compiled in memory
                             │
                             └─► Class groovyClassInternal (in-memory JVM class)
                                    │
                                    └─ Trigger: Every run() call thereafter
                                       Tool: InvokerHelper.createScript(groovyClass, contextBinding)
                                       → Script.run()
                                       → result Map returned
```

> [!IMPORTANT]
> **The FTL template in step 1** is the magic bridge. Moqui XML actions like `<entity-find>`, `<set>`, `<if>` are NOT interpreted directly. Instead, a FreeMarker template converts the XML node tree into equivalent Groovy source code. That Groovy is then compiled to bytecode. So XML actions are ultimately executed as compiled Groovy.

---

### 4c. Standalone `.groovy` Script → Compiled Class

Used for `type="script"` services and for `ResourceFacade.runScript()` calls.

```
service/MyScript.groovy  (disk file, a service with type="script")
  │
  ├─ Trigger: ScriptServiceRunner.runService() called
  ├─ Tool: GroovyScriptRunner.getGroovyByLocation()
  │
  └─► scriptGroovyLocationCache.get(location)  → cache miss on first call
        │
        ├─ Tool: ResourceFacadeImpl.getLocationText() → reads file text
        ├─ Tool: ecfi.compileGroovy(groovyText, className)
        │         → GroovyClassLoader.parseClass(script, className)
        │         → bytecode created IN MEMORY (not written to disk by default)
        │
        └─► Class object (Groovy script compiled to JVM class)
              │
              └─ stored in: scriptGroovyLocationCache (JCache, persistent)
                 (cache key = file location string)

              Trigger at runtime:
              Tool: InvokerHelper.createScript(cachedClass, ec.contextBinding)
                    → Script.run() or script.invokeMethod(method, null)
```

**Is the result stored on disk?** By default: **no**. The class lives only in JVM memory. The flag `groovyCompileCacheToDisk` (in `ExecutionContextFactoryImpl`, line 107) is `false` by default. Setting it to `true` writes `.class` files to `runtime/script-classes/`.

---

### 4d. Inline Groovy inside XML (e.g., `<script>` tag)

```xml
<actions>
  <script>ec.logger.info("hello")</script>
  <set field="x" from="someValue * 2"/>
</actions>
```

```
<actions> MNode (already in RAM from XML parse)
  │
  ├─ Trigger: XmlAction.getGroovyString() (first call)
  ├─ Tool: FreeMarker template (XmlActions.groovy.ftl)
  │         reads the MNode tree and writes out Groovy source:
  │
  │   <script> → becomes a literal Groovy block in the output source
  │   <set>    → becomes: x = someValue * 2
  │   <entity-find> → becomes: ec.entity.find(...).list()
  │
  └─► Single groovy source String
        │
        ├─ Tool: ecfi.compileGroovy(groovySource, uniqueClassName)
        └─► Class (cached in XmlAction.groovyClassInternal field)
```

The entire `<actions>` block is compiled as **one single Groovy class**, not statement-by-statement.

---

### 4e. Java Files → Compiled .class

```
framework/src/main/java/**/*.java
framework/src/main/groovy/**/*.java  (yes, Java files can be in the groovy source dir)
  │
  ├─ Trigger: Gradle build (`./gradlew build`)
  ├─ Tool: javac (standard Java compiler)
  │
  └─► .class files → packaged into moqui.war / moqui.jar
        └─ loaded at JVM startup by standard ClassLoader
        └─ NO runtime Java compilation happens inside Moqui
```

At runtime, `JavaServiceRunner.runService()` just does `Class.forName(sd.location)` → `method.invoke()`. The class was already compiled at build time.

---

### 4f. FreeMarker `.ftl` → HTML

```
screen/MyApp/MyScreen.xml.ftl   (or widget macro template)
  │
  ├─ Trigger: First HTTP request to this screen
  ├─ Tool: FtlTemplateRenderer.getFtlTemplateByLocation()
  │         → reads file bytes, builds freemarker.template.Template object
  │         → stored in templateFtlLocationCache
  │
  └─► freemarker.template.Template object (in-memory compiled FTL)
        │
        ├─ Trigger: Every render call (ScreenRenderImpl renders widgets)
        ├─ Tool: template.createProcessingEnvironment(contextStack, writer).process()
        │         Context (ec.contextStack) provides variables: ec, entityValue, etc.
        │         FTL engine merges template + data → writes HTML chars to Writer
        │
        └─► HTML string streamed to HTTP response Writer
```

Important: The FTL `Template` object is the "compiled" form — the template text is pre-parsed to an AST inside the `Template`. The **data merging** (Template + Context → HTML) happens **on every request**.

---

## 5. Groovy Processing Pipeline

### 5a. The three Groovy tools — explained simply

| Tool | Analogy | What it does | Does Moqui use it? |
|---|---|---|---|
| `GroovyShell` | A calculator: type an expression, get a result | Evaluates a Groovy expression dynamically, no caching | Rarely (for one-off expressions) |
| `GroovyScriptEngine` | A script file watcher | Watches .groovy files, re-compiles on change | Not used by Moqui |
| `GroovyClassLoader` | A Java class loader that also understands Groovy | Compiles Groovy text to JVM bytecode (a Class), caches it | **YES — Moqui's primary tool** |

**Moqui uses `GroovyClassLoader`** exclusively for compilation (via `ecfi.compileGroovy()`). The key call is:

```groovy
// ExecutionContextFactoryImpl.groovy, line 1102
return groovyClassLoader.parseClass(script, className)
```

This compiles the Groovy source to a JVM `Class` object in memory. The class is then **cached** — so compilation only ever happens once per unique script.

### 5b. Cache for Groovy scripts

| Script type | Cache | Cache key | Cache class |
|---|---|---|---|
| Standalone `.groovy` files | `scriptGroovyLocationCache` | File location string | `GroovyScriptRunner` (line 37) |
| XML action blocks | Field `groovyClassInternal` in `XmlAction` | N/A (held by the `XmlAction` object itself) | `XmlAction` (line 41) |
| Groovy expressions (`${...}`) | `expressionCache` | Expression string | `ResourceFacadeImpl` (line 585) |

### 5c. What happens when a Groovy script runs?

```
Cached Class (Groovy compiled class)
  │
  ├─ Tool: InvokerHelper.createScript(cachedClass, ec.contextBinding)
  │         Creates a new Script instance (very cheap — just allocates object)
  │         Sets the binding to ec.contextStack (so `ec`, `parameters`, etc. are available)
  │
  └─► script.run() — executes the compiled bytecode
        ├─ variables resolved from context (Groovy Binding)
        └─ returns result (Map or Object)
```

**The Class is never re-created per request.** Only a lightweight `Script` wrapper is created each time.

---

## 6. Java Compilation & Integration

### What Java files exist in Moqui?

Looking at your local source, `framework/src/main/groovy/org/moqui/impl/` contains a mix:

- **Pure Java** (`.java`): `ServiceDefinition.java`, `ServiceCallSyncImpl.java`, `EntityValueBase.java`, `XmlAction.java`, `FtlTemplateRenderer.java`, `InlineServiceRunner.java`
- **Groovy** (`.groovy`): `ServiceFacadeImpl.groovy`, `ScreenFacadeImpl.groovy`, `EntityFacadeImpl.groovy`, etc.

Both are **pre-compiled by Gradle at build time**. There is no runtime Java compilation. The Groovy compiler handles `.groovy` files; Javac handles `.java` files.

### How does compiled Java interact with dynamic Groovy?

They share the same JVM ClassLoader chain:

```
Bootstrap ClassLoader (JDK)
  └─ System ClassLoader
        └─ MClassLoader (Moqui's custom loader — loads jars from runtime/lib, component/lib)
              └─ GroovyClassLoader (extends MClassLoader — also compiles .groovy on demand)
```

Because `GroovyClassLoader` sits on top of `MClassLoader`, when Groovy code calls a Java class (e.g., `ServiceDefinition`), it looks up through the chain and finds the pre-compiled Java class. They interoperate without any glue code.

### Java service (type="java")

For a service declared as `type="java"`:

```groovy
// JavaServiceRunner.groovy, line 61
Class c = ObjectUtilities.getClass(sd.location)
if (c == null) c = Thread.currentThread().getContextClassLoader().loadClass(sd.location)
Method m = c.getMethod(sd.method, ExecutionContext.class)
result = m.invoke(c.newInstance(), ec)
```

The class must already be on the classpath (in `component/classes/` or a JAR in `component/lib/`). No runtime compilation.

---

## 7. Service Execution Lifecycle

**Scenario:** `ec.service.sync().name("myapp.MyService#myMethod").call()`

### Step 1 — Locate the ServiceDefinition

```
ec.service.sync()
  └─► new ServiceCallSyncImpl(sfi)         [ServiceFacadeImpl.sync()]
        .name("myapp.MyService#myMethod")
        .call()
          │
          └─► ServiceCallSyncImpl.callSync()
                │
                ├─ sfi.getServiceDefinition("myapp.MyService#myMethod")
                │    └─ parse: path="myapp.MyService", verb="my", noun="Method"
                │    └─ check: serviceLocationCache.get(cacheKey) → cache hit or miss
                │    └─ if miss: makeServiceDefinition()
                │         └─ findServiceNode(): search component service dirs
                │              file = "service/myapp/MyService.xml"
                │              MNode.parse(file) → find <service verb="my" noun="Method">
                │         └─ new ServiceDefinition(sfi, path, serviceNode)
                │         └─ put in serviceLocationCache
                │
                └─► ServiceDefinition sd (in hand)
```

### Step 2 — Dispatch to the right runner

```
sd.serviceType → "inline" (has <actions>) → sd.serviceRunner = InlineServiceRunner
              → "java"   (type="java")    → sd.serviceRunner = JavaServiceRunner
              → "script" (type="script")  → sd.serviceRunner = ScriptServiceRunner
              → "entity-auto"             → sd.serviceRunner = EntityAutoServiceRunner
```

Moqui uses a **Strategy pattern** here — each runner implements `ServiceRunner.runService(sd, parameters)`.

### Step 3 — Validate parameters

```
ServiceCallSyncImpl → sd.convertValidateCleanParameters(parameters, eci)
  └─ ServiceDefinition.nestedParameterClean()
        for each ParameterInfo in inParameterInfoArray:
          ├─ apply default value if missing
          ├─ convert type (e.g., String "123" → Integer 123)
          ├─ check required flag (add validation error if empty)
          └─ run validation rules: <matches>, <number-range>, <text-email>, etc.
        └─► cleaned Map<String, Object> parameters
```

If there are validation errors, `eci.getMessage().hasError()` returns true and the service may be halted based on configuration.

### Step 4 — Manage database transaction

```
ServiceCallSyncImpl.callSync()
  ├─ check sd.txIgnore    → if true: no transaction management
  ├─ check sd.txForceNew  → if true: suspend any existing tx, begin new one
  ├─ check sd.txUseCache  → if true: use transaction-level entity cache
  ├─ begin transaction via TransactionFacadeImpl.begin(sd.txTimeout)
  │
  ├─── sd.serviceRunner.runService(sd, cleanedParameters)  ← service logic runs here
  │
  ├─ if no errors: TransactionFacadeImpl.commit()
  └─ if errors:    TransactionFacadeImpl.rollback()
```

Moqui uses JTA (Java Transaction API) — the same standard used by Java EE app servers. Every service call is wrapped in a transaction by default.

### Step 5 — Return results

```
runService() returns Map<String, Object>
  │
  ├─ ServiceDefinition.checkOutputParameters() → validates out-parameter types
  └─► result Map returned to caller
```

The caller gets a plain `Map<String, Object>`. Any entity values, lists, or scalars are in there.

---

## 8. Screen Rendering Lifecycle

**Scenario:** Browser GETs `https://myapp.com/apps/myapp/MyScreen`

### Step 1 — HTTP request → screen path resolution

```
HTTP GET /apps/myapp/MyScreen
  │
  └─► WebFacadeImpl.handleWebRequest()
        └─► ScreenRenderImpl.render()
              │
              ├─ determine rootScreen from webapp config (host → root-screen location)
              ├─ split URL path: ["apps", "myapp", "MyScreen"]
              │
              └─► ScreenUrlInfo.getScreenUrlInfo()
                    walks path segments through SubscreensItem maps
                    each segment looks up the child screen location
                    └─► targetScreen = ScreenDefinition for MyScreen.xml
```

**Key class:** `ScreenUrlInfo` — resolves a URL path to a chain of `ScreenDefinition` objects. Cached in `screenUrlCache`.

### Step 2 — Resolve nested includes

Moqui screens can `<include location="..."/>` other screens. These are resolved when `ScreenDefinition` is constructed:

```
ScreenDefinition (MyScreen.xml)
  ├─ <include location="component://myapp/screen/Header.xml"/>
  │    └─► ScreenFacadeImpl.getScreenDefinition(location)
  │         → MNode.parse() → new ScreenDefinition() → cached
  │
  └─ widget nodes merged in order (header, body, footer)
```

This forms a tree of `ScreenDefinition` objects resolved at definition-load time, not at render time.

### Step 3 — `<actions>` execution

Before rendering any HTML, the screen's `<actions>` block runs:

```
ScreenRenderImpl.renderScreenDef(sd)
  │
  ├─ sd.actions != null?
  │    └─► sd.actions.run(eci)     [XmlAction.run()]
  │          └─ InvokerHelper.createScript(groovyClass, contextBinding).run()
  │               - fetches entities, sets context vars, calls services, etc.
  │
  └─► eci.contextStack now has all the data the widgets need
```

**Key point:** `<actions>` runs BEFORE widget rendering. It "loads the plate" with data that the FTL template will "serve" to the browser.

### Step 4 — FreeMarker renders widgets

```
ScreenRenderImpl.renderWidgets(sd, writer)
  │
  ├─ get render mode → "html" (for browser requests)
  ├─ ScreenFacadeImpl.getTemplateByMode("html")
  │    └─► FTL Template object for html.macro.ftl (widget macro library)
  │
  ├─ template.createProcessingEnvironment(eci.contextStack, writer).process()
  │    FreeMarker walks the widget MNode tree:
  │    <form> → calls #form macro → outputs <table>/<input> HTML
  │    <label>→ calls #label macro → outputs <span> HTML
  │    ${someVar} → looks up in contextStack → outputs value
  │
  └─► HTML characters streamed into Writer (no intermediate String!)
```

FreeMarker writes directly to an output `Writer` — HTML is streamed out character-by-character, not assembled as a giant String in memory.

### Step 5 — Response sent to browser

```
Writer → HttpServletResponse.getOutputStream()
  └─► Jetty (or other servlet container) buffers → TCP socket → browser
```

The `Content-Type: text/html` and appropriate HTTP status code are set by `WebFacadeImpl` before rendering begins.

---

## 9. Summary Table

| File Type | Compiled? | When Processed | Result Cached? | Cache Location | Who Processes It |
|---|---|---|---|---|---|
| Entity `*.xml` | No (→ MNode → EntityDefinition) | Startup | Yes (permanent) | `entity.definition` JCache | `EntityFacadeImpl` |
| Service `*.xml` | Partially (MNode → SD; `<actions>` → Groovy Class) | First call (lazy) | Yes | `serviceLocationCache` JCache | `ServiceFacadeImpl` + `ServiceDefinition` |
| Screen `*.xml` | Partially (MNode → ScreenDef; `<actions>` → Groovy Class) | First request (lazy) | Yes, with mod-check | `screenLocationCache` + `screenLocationPermCache` | `ScreenFacadeImpl` + `ScreenDefinition` |
| Standalone `.groovy` | Yes (to in-memory JVM Class) | First call (lazy) | Yes | `scriptGroovyLocationCache` JCache (`resource.groovy.location`) | `GroovyScriptRunner` + `ecfi.compileGroovy()` |
| Inline Groovy in XML | Yes (entire `<actions>` → one Class) | First call (lazy) | Yes (field in `XmlAction`) | `XmlAction.groovyClassInternal` field | `XmlAction.makeGroovyClass()` via `ecfi.compileGroovy()` |
| `*.java` (framework) | Yes (ahead of time, by Gradle) | Build time | Permanent (in JAR) | JVM ClassLoader | Gradle + `javac` |
| `*.ftl` template | Parsed (→ `freemarker.template.Template`) | First use | Yes | `templateFtlLocationCache` JCache (`resource.ftl.location`) | `FtlTemplateRenderer` |
| Data `*.xml` | No (read row by row) | On demand (data load) | No | — | `EntityDataLoaderImpl` |
| SECA `*.secas.xml` | No (→ `ServiceEcaRule` objects) | Startup | Yes (in-memory Map) | `secaRulesByServiceName` Map | `ServiceFacadeImpl.loadSecaRulesAll()` |
| `MoquiDefaultConf.xml` | No (→ MNode) | Startup | Yes (merged → `confXmlRoot`) | `ecfi.confXmlRoot` field | `ExecutionContextFactoryImpl.initBaseConfig()` |
| `*.properties` | No | As needed | Depends | Java `Properties` object | Standard Java + Moqui `SystemBinding` |

---

## Key Analogies Reference

| Moqui Concept | Real-World Analogy |
|---|---|
| `ExecutionContextFactory` (ECFI) | The restaurant building — one per server |
| `ExecutionContext` (EC) | One customer's table — one per request/thread |
| `MNode` | A photocopy of an XML document in RAM |
| `ServiceDefinition` | A recipe card — describes ingredients (params) and steps (actions) |
| `XmlAction` | A recipe card's steps translated into restaurant language |
| `GroovyClassLoader.parseClass()` | Turning a written recipe into muscle memory (compiled code) |
| `FreeMarker Template` | A plate design — the mold into which you pour data |
| `ServiceRunner` | The correct chef (inline, Java, Groovy) for a given recipe type |
| `EntityFacade` | The pantry manager — knows every ingredient (entity) |
| `ContextStack` | A waiter's notepad — variables written here are visible to the current screen/service |

---

## Important Class Reference Quick-Map

| Class | Package | What it does (one line) |
|---|---|---|
| `ExecutionContextFactoryImpl` | `org.moqui.impl.context` | The boot controller; owns all facades |
| `ExecutionContextImpl` | `org.moqui.impl.context` | Per-request context; provides `ec` variable |
| `ServiceFacadeImpl` | `org.moqui.impl.service` | Locates & dispatches all service calls |
| `ServiceDefinition` | `org.moqui.impl.service` | Immutable description of one service (params, type, runner) |
| `ServiceCallSyncImpl` | `org.moqui.impl.service` | Orchestrates one synchronous service call (tx, validation, run) |
| `XmlAction` | `org.moqui.impl.actions` | Converts XML actions to Groovy; holds compiled Class |
| `InlineServiceRunner` | `org.moqui.impl.service.runner` | Runs inline XML services via `XmlAction.run()` |
| `JavaServiceRunner` | `org.moqui.impl.service.runner` | Dispatches to a pre-compiled Java method via reflection |
| `ScriptServiceRunner` | `org.moqui.impl.service.runner` | Runs a standalone `.groovy` script via `GroovyScriptRunner` |
| `EntityAutoServiceRunner` | `org.moqui.impl.service.runner` | Auto CRUD for entity-auto services (create/update/delete) |
| `GroovyScriptRunner` | `org.moqui.impl.context.runner` | Compiles and caches standalone `.groovy` files |
| `ScreenFacadeImpl` | `org.moqui.impl.screen` | Manages screen caches, FTL templates |
| `ScreenDefinition` | `org.moqui.impl.screen` | Parsed representation of one `*.xml` screen file |
| `ScreenRenderImpl` | `org.moqui.impl.screen` | Executes actions + renders widgets for one request |
| `ScreenUrlInfo` | `org.moqui.impl.screen` | Resolves URL path → chain of `ScreenDefinition` objects |
| `FtlTemplateRenderer` | `org.moqui.impl.context.renderer` | Parses `.ftl` files and merges data into HTML |
| `EntityFacadeImpl` | `org.moqui.impl.entity` | Loads entity definitions; entry point for all DB operations |
| `EntityDefinition` | `org.moqui.impl.entity` | Describes one entity (table): fields, relations, PKs |
| `MNode` | `org.moqui.util` | Moqui's XML node class (fast, custom parser) |
