# Open edX OLX Problem Converter

A powerful, production-ready browser-based tool for converting educational problem sets into Open edX OLX (Open Learning XML) format. This application streamlines the process of creating **Open edX Library v1** content for the Open edX platform, supporting multiple question types, rich text formatting, and advanced mathematical equation rendering.

**Version 5.0.0-alpha** | refactored core, test suite, surfaced warnings
_(stable previous release: [v4.3](https://github.com/JoeMartis/problem-converter-new/tree/v4.3) — revert with `git reset --hard fbfe764`)_

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 🌟 Features

### Problem Type Support
- ✅ **Multiple Choice** - Single correct answer
- ✅ **Multi-Select** - Multiple correct answers (checkbox)
- ✅ **Numerical Response** - Numeric answers with validation
- ✅ **Text Input** - Free-form text responses

### Rich Text Formatting
- **Bold**, *Italic*, <u>Underline</u>
- Superscript and Subscript
- Inline and block code
- Hyperlinks with custom text
- **LaTeX Equations** - Full MathJax support with live preview
- All formatting preserved in OLX output

### Advanced Capabilities
- 📁 **File Upload Support** - Import from .txt or .docx files
- 🔄 **Live Preview** - Real-time problem rendering with MathJax
- ✏️ **In-Place Editing** - Edit questions, choices, and explanations directly
- 📊 **Statistics Dashboard** - Track problem counts and warnings
- 📦 **Batch Processing** - Convert multiple problems at once
- 💾 **Library Export** - Download as `.tar.gz` with Open edX Library v1 structure (directly importable into edX Studio)
- 📋 **Copy to Clipboard** - Quick OLX export
- 🎨 **Modern UI** - Clean, responsive design
- 🎯 **Smart Attempts Policy** - Automatic retry configuration based on problem type
- 🧮 **Automatic Math Detection** - Intelligent LaTeX wrapping for mathematical expressions
- 📝 **Flexible Input Formats** - Support for multiple answer format styles

## 🚀 What's new in v5.0.0-alpha

v5 is a structural refactor on top of v4.3 with new validation surfaces and
a real test suite. Every change is covered by regression tests.

### Architecture
- **JS extracted from `index.html`** to `src/converter.js` (~2,500 lines). The
  HTML file shrank from ~3,900 lines to ~1,300.
- **Test suite** under `test/` with 44 regression tests and a 37-file `.docx`
  corpus runner. Runs via `npm test`.
- **`parseProblems` refactored** from a 627-line monolith into a 16-handler
  state machine + a single `finalizeProblem()` helper. Most of the flag-
  interaction bugs we kept finding were duplication-driven; that class is
  now gone.

### Parsing improvements
- **Q-style labels** (`Q1-A`, `Q2-B (Existing)`) recognized as problem
  titles, including hyphen, en-dash, em-dash, and parenthetical notes.
- **Multi-line question bodies** — setup text that precedes the `?` line
  is now preserved instead of being overwritten.
- **Greek / Cyrillic letter folding** — `Correct: Α` (Greek alpha) and
  choice prefixes like `Α.` / `Β.` are recognized as Latin A / B.
- **Word `<strong>` markers** — `<strong>Correct: B</strong>`,
  `<strong>Explanation:</strong>`, and cross-line tag pairs are
  normalized before parsing.
- **LaTeX-labelled choices** — `\begin{align*}…\mathbf{(A)}…\mathbf{(B)}…
  \end{align*}` and `$$\mathbf{(A)}…$$` blocks become per-choice lines.
- **Math expressions no longer mis-split** — `x=0. Which…` stays on one
  line; the `\d+.` splitter only fires after whitespace.
- **Numerical answers** handle `.5`, `+5`, and scientific notation.
- **Answer: / Explanation:** same-line split only fires on capital-E
  `Explanation:` so lowercase in answer text stays intact.
- **Section headers** like `Q1 – Objective` are skipped instead of being
  absorbed into the previous explanation.

### Warnings surfaced in the UI
Warnings used to be `console.warn` output, invisible unless DevTools was
open. They now appear in a collapsible panel below the status bar and as
a `⚠ N` badge on each affected problem in the preview.

Warning categories:
- `correct_out_of_range` — `Correct:` letter references a choice that
  doesn't exist.
- `correct_unparseable` — `Correct:` line has no recognizable A-Z letter.
- `empty_question`, `no_content`, `no_correct_marker`, `too_few_choices`,
  `empty_choice`, `missing_explanation`, `choice_too_long`.

Warnings re-compute after every preview edit, so fixing an issue in the
UI clears the badge live.

### Security & reliability
- **Contenteditable XSS** — edits are sanitized via an allowlist-based
  sanitizer. Script tags, iframes, and `javascript:` / `data:` / `blob:`
  URLs are stripped.
- **Mammoth .docx upload** — parsed via `DOMParser` + sanitizer instead
  of raw `innerHTML` assignment.
- **Placeholder collision** — escape helpers use a per-call random
  seed, so user text containing literal `__LATEX_0__` no longer gets
  substituted.
- **href scheme whitelist** — only `http`, `https`, `mailto`, `tel`,
  anchor, and relative URLs are accepted in sanitized HTML.
- **Attribute escaping** — anchor and `<pre><code>` attributes route
  through `escapeXml`.
- **Cross-field edit debounce fix** — rapid edits across different
  fields no longer drop prior keystrokes.
- **Download debounce + URL cleanup** for both OLX and library archive.
- **Library archive is `.tar.gz`** (POSIX tar + gzip) so edX Studio's
  "Import Library" accepts the file directly. Tar is generated in
  ~100 lines of JS and gzipped via the browser's native
  `CompressionStream`; the JSZip CDN dependency was dropped.
- **Crypto UUIDs** — prefer `crypto.randomUUID` / `getRandomValues` over
  `Math.random`.
- **Unicode filenames** — `makeSafeFilename` preserves non-ASCII letters
  while still neutralizing path-traversal.
- **Library metadata snapshot** — download-library uses the metadata
  from the actual conversion, not a fresh re-parse of possibly-edited
  input.

### Deprecated
- `olx-converter-enhanced.html` — now annotated as legacy; missing the
  v5 sanitizer, warnings UI, and parser improvements.

## 🚀 Recent Improvements (v2.0 → v4.3)

### Major Enhancements
- ✅ **Automatic LaTeX Detection & Wrapping** - Intelligent mathematical expression recognition
- ✅ **MathJax Live Preview** - Real-time equation rendering in preview panel
- ✅ **Markdown Code Snippet Support** - Triple backtick code blocks preserved
- ✅ **Intelligent Checkbox Detection** - Automatic multi-select identification from "(select all that apply)"
- ✅ **Flexible Answer Formats** - Support for "Answer: X", "Correct: A, C", and inline "(correct)" markers
- ✅ **Attempts Policy Matrix** - Smart retry limits based on problem complexity
- ✅ **Bullet Point Support** - Proper rendering of bulleted lists in questions/explanations
- ✅ **End Explanation Markers** - Explicit control over explanation boundaries
- ✅ **Unprefixed Choice Support** - Handle choices without A), B), C) prefixes

### Critical Bug Fixes (50+ fixes)
- 🐛 **Fixed:** Choices being skipped due to blank lines
- 🐛 **Fixed:** Question setup text lost after explanations
- 🐛 **Fixed:** Explanation content bleeding into next question
- 🐛 **Fixed:** LaTeX brackets being stripped ([ and ] preservation)
- 🐛 **Fixed:** Greek letter prefixes causing choice parsing issues
- 🐛 **Fixed:** Multi-line choices with LaTeX math blocks
- 🐛 **Fixed:** Stale questionEnded flag causing parsing errors
- 🐛 **Fixed:** Library export missing required url_name attributes
- 🐛 **Fixed:** Reserved JavaScript keywords causing syntax errors
- 🐛 **Fixed:** Greedy regex causing variable merging in equations

### Parser Robustness
- **457 lines of new code** added for enhanced functionality
- **86 lines refactored** for better performance and maintainability
- **15+ parsing edge cases** resolved
- **3 major format variations** now supported

## 🚀 Quick Start

### Option 1: Direct Use (No Installation)
1. Download or clone this repository
2. Open `index.html` in any modern web browser
3. Start converting problems immediately!

### Option 2: Serve Locally
```bash
# Clone the repository
git clone https://github.com/yourusername/Problem-converter-new.git
cd Problem-converter-new

# Serve with Python (example)
python -m http.server 8000

# Or with Node.js
npx http-server
```

Then navigate to `http://localhost:8000`

## 📝 Usage Guide

### Input Format

The converter supports multiple input formats:

#### Format 1: Part-Question Style
```
Part 1 Question 1
What is the capital of France?
A) London
B) Berlin
C) Paris (correct)
D) Madrid

Explanation: Paris is the capital and largest city of France.
```

#### Format 2: Numbered Questions
```
1. Which programming language is known for web development?
A) Python
B) JavaScript (correct)
C) Java
D) C++

Explanation: JavaScript is the primary language for client-side web development.
```

#### Format 3: Multi-Select Problems
```
Which of the following are primary colors? (select all that apply)
A) Red (correct)
B) Green
C) Blue (correct)
D) Yellow (correct)
E) Purple

Explanation: Red, blue, and yellow are the primary colors in traditional color theory.
```

#### Format 4: Numerical/Text Response
```
What is 2 + 2?
Answer: 4
Explanation: Basic arithmetic addition.
```

#### Format 5: Alternative Answer Formats
```
1. Which of the following are prime numbers?
A) 2
B) 4
C) 7
D) 9
Correct: A, C
Explanation: 2 and 7 are prime numbers (only divisible by 1 and themselves).
```

#### Format 6: Code Snippets
```markdown
What does this code output?
```python
def greet(name):
    return f"Hello, {name}!"
print(greet("World"))
```
A) Hello, World!  (correct)
B) greet("World")
C) Error
D) None

Explanation: The f-string formats the output as "Hello, World!"
```

### Metadata (Optional)

Add metadata at the beginning of your input:

```
Organization: MyUniversity
Legacy Library Name: Math 101 Problems
Library ID: MATH101_PROBLEMS
Label: Week 1 Quiz

[Your problems here...]
```

### Attempts Policy Matrix

The converter automatically applies intelligent retry limits based on problem complexity:

| Problem Type | Max Attempts | Rationale |
|--------------|--------------|-----------|
| **Multiple Choice (2 choices)** | 2 attempts | Binary choice - one retry is sufficient |
| **Multiple Choice (3-5 choices)** | 3 attempts | Standard complexity - allows learning from mistakes |
| **Multiple Choice (6+ choices)** | 5 attempts | High complexity - more chances to learn |
| **Multi-Select (Checkbox)** | 5 attempts | Combinatorial complexity - needs more attempts |
| **Numerical Response** | 3 attempts | Calculation errors - moderate retry allowance |
| **Text Input** | Unlimited | Free-form - encourage iteration |

This evidence-based approach balances learning opportunities with answer security.

### File Upload

**Supported Formats:**
- `.txt` - Plain text files
- `.docx` - Microsoft Word documents

The converter automatically extracts and processes formatting from Word documents.

### LaTeX Equations

The converter fully supports LaTeX mathematical expressions with live preview:

**Inline Math** (within text):
```
What is the solution to \( x^2 + 5x + 6 = 0 \)?
Alternatively: What is $E = mc^2$ in joules?
```

**Display Math** (centered, on its own line):
```
The quadratic formula is:
\[ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} \]

Or using dollar signs:
$$ \int_0^1 x^2 dx = \frac{1}{3} $$
```

**Using the Equation Editor:**
1. Click the ∑ button in the toolbar
2. Select equation type (inline or display)
3. Enter LaTeX code (preview updates live)
4. Click "Insert Equation"

**Common LaTeX Commands:**
- Fractions: `\frac{a}{b}`
- Square root: `\sqrt{x}`
- Powers: `x^2` or `x^{2n}`
- Subscripts: `x_i` or `x_{i,j}`
- Greek letters: `\alpha, \beta, \gamma, \pi`
- Summation: `\sum_{i=1}^n`
- Integration: `\int_0^1`
- Limits: `\lim_{x \to \infty}`

**Features:**
- ✅ Live preview with MathJax rendering
- ✅ Syntax validation for balanced delimiters
- ✅ Both inline and display modes
- ✅ Multiple delimiter styles supported
- ✅ Preserved in OLX output
- ✅ Renders properly on Open edX platform

## 🎯 Step-by-Step Workflow

1. **Input Problems**
   - Type or paste into the text area
   - Upload a .txt or .docx file
   - Or load sample problems to see examples

2. **Review Preview**
   - Check parsed problems in the preview panel
   - Edit directly by clicking on any field
   - Navigate between problems or view all at once

3. **Export**
   - **Copy OLX** - Copy XML to clipboard for manual use
   - **Download** - Get plain OLX file
   - **Download Library** - Get the complete Open edX Library v1 structure as a `.tar.gz` archive (import directly into edX Studio via **Tools → Import**)

## 📊 Statistics & Validation

The built-in statistics panel shows:
- Total problem count
- Breakdown by type (MC, Multi-select, Numerical, Text)
- Average choices per problem
- ⚠️ **Warning count** — how many issues the parser and validator
  flagged on the current conversion.

### Warnings panel

Below the status bar, a collapsible yellow panel lists every warning with
the problem it came from. Each warning has:

- a **source** (`parser` — from the raw input; `validator` — from a
  shape check against the parsed problem),
- a **severity** (`warn` or `info`),
- a **code** (e.g. `no_correct_marker`, `correct_out_of_range`,
  `empty_choice`),
- a **message** describing the issue.

Individual problems in the preview get a `⚠ N` badge next to their
title. Hovering the badge shows the full messages as a tooltip. Edit a
problem to fix an issue and the badge refreshes in place.

### Programmatic access

`parseProblems(text)` returns:

```js
{
  problems:          [ /* parsed problem objects */ ],
  displayNameLabel:  'Problem',
  libraryOrg:        '...',
  libraryName:       '...',
  libraryId:         '...',
  warnings:          [ /* { problemIndex, code, severity, source, message } */ ]
}
```

## 🔧 Technical Details

### Technology Stack
- **Frontend only** — no backend, no build step for the app itself.
- **Pure HTML/CSS/JavaScript** — `index.html` loads `src/converter.js`
  as a plain script.
- **Runtime dependencies** (loaded from CDN by the browser):
  - Mammoth.js v1.6.0 — Word document parsing
  - MathJax v3 — LaTeX equation rendering
  - Google Fonts — Typography
  - *No archive library*: tar is written inline; gzip uses the
    browser's native `CompressionStream` API.
- **Dev dependencies** (for `npm test` only; not shipped to users):
  - `jsdom` — DOM shim for tests
  - `mammoth` — same library as the browser uses, for `.docx` corpus
    regression

### Browser Support
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Opera 76+

### Performance Optimizations
- Event delegation for memory efficiency
- Optimized XML generation with array joins
- Cached DOM queries
- No memory leaks

### Security Features
- XSS protection with HTML escaping
- Content Security Policy ready
- Safe XML generation with entity encoding

## 🏗️ Project Structure

```
Problem-converter-new/
├── index.html                      # HTML shell; loads src/converter.js
├── src/
│   └── converter.js                # Core logic: parser, sanitizer, UI
├── test/
│   ├── harness.mjs                 # Loads converter into JSDOM
│   ├── parser.test.mjs             # 42 parser regression tests
│   ├── assignments.test.mjs        # .docx corpus regression
│   └── run.mjs                     # Dispatcher (npm test)
├── olx-converter-enhanced.html     # Deprecated baseline (v4 era)
├── package.json                    # Dev deps for the test suite
├── README.md
└── LICENSE
```

The browser still loads a single HTML page; `src/converter.js` is a plain
`<script>` (no build step). Tests are Node-only and don't affect the
browser app.

## 🧪 Development & Testing

```bash
# Install dev dependencies (mammoth + jsdom) for the test suite.
npm install

# Run everything (unit tests + assignments corpus if ASSIGNMENTS_DIR is set).
npm test

# Run just the unit tests.
npm run test:unit

# Run against a directory of .docx files.
ASSIGNMENTS_DIR=/path/to/unzipped/assignments npm run test:assignments
```

The assignments suite is skipped silently when `ASSIGNMENTS_DIR` doesn't
exist, so `npm test` works on a fresh checkout without needing a corpus.

**Reverting the v5 refactor.** The last v4 commit is tagged `v4.3`
(commit `fbfe764`). To return to the pre-refactor state:

```bash
git reset --hard fbfe764
# or, once the tag is pushed:
git reset --hard v4.3
```

## 🎨 Customization

### Styling
The application uses CSS custom properties. To customize colors:

```css
/* Edit the :root section in index.html */
:root {
    --bg-primary: #0a0e1a;      /* Main background */
    --accent-cyan: #00d4ff;     /* Primary accent */
    --accent-blue: #0066ff;     /* Secondary accent */
    /* ... more variables */
}
```

### Adding Problem Types
Extend the parser in the `parseProblems()` function to support custom formats.

## 📖 Open edX OLX Output

The generated OLX follows Open edX standards:

```xml
<problem display_name="Problem 1" markdown="null">
  <multiplechoiceresponse>
    <label>What is the capital of France?</label>
    <choicegroup type="MultipleChoice">
      <choice correct="false">London</choice>
      <choice correct="false">Berlin</choice>
      <choice correct="true">Paris</choice>
      <choice correct="false">Madrid</choice>
    </choicegroup>
  </multiplechoiceresponse>
  <solution>
    <div class="detailed-solution">
      <p>Explanation</p>
      <p>Paris is the capital and largest city of France.</p>
    </div>
  </solution>
</problem>
```

## 🐛 Known Limitations

- Maximum file size for uploads: ~50MB (browser dependent)
- Images must be added manually after export
- No support for adaptive/conditional problems

## 🤝 Contributing

Contributions are welcome! Recent accomplishments and future areas:

### Recently Completed ✅
- [x] LaTeX equation editor integration with live preview
- [x] Automatic mathematical expression detection
- [x] Markdown code snippet support
- [x] Intelligent multi-select detection
- [x] Flexible answer format parsing
- [x] Attempts policy matrix implementation
- [x] Comprehensive bug fixes (50+ issues resolved)
- [x] Parser robustness improvements

### Future Enhancements
- [ ] Image upload and embedding support
- [ ] Additional problem types (drag-and-drop, hotspot, etc.)
- [ ] Template system for custom institutional formats
- [ ] Internationalization (i18n)
- [ ] Import from existing OLX (reverse conversion)
- [ ] Collaborative editing features

### Development Workflow

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Make your changes — most logic lives in `src/converter.js`; the UI
   shell is `index.html`.
4. **Run the test suite before committing:**
   ```bash
   npm install
   npm test
   ```
   Add a regression test under `test/parser.test.mjs` for any new bug
   you fix.
5. Test in the browser too — open `index.html` directly, convert the
   bundled sample, try a `.docx` upload, verify the warnings panel
   behaves.
6. Commit with descriptive messages.
7. Push and open a Pull Request.

### Testing Checklist

Automated (via `npm test`):
- [x] Basic problem parsing (MC, Multi-select, Numerical, Text)
- [x] Numerical regex edge cases (`.5`, `+5`, sci notation)
- [x] `Answer:` / `Explanation:` split
- [x] Q-label titles (`Q1-A`, `Q2-B`)
- [x] Multi-line question accumulation
- [x] Math-period preservation (`x=0. Which…`)
- [x] Greek/Cyrillic folding in `Correct:` and choice prefixes
- [x] Section-header skip
- [x] Emphasis-tag normalization (`<strong>Correct: B</strong>` etc.)
- [x] LaTeX `\mathbf{(A)}` choice-block splitting
- [x] Sanitizer allowlist + href scheme whitelist
- [x] XML attribute escaping (anchor + `<pre><code>`)
- [x] Placeholder-collision guard in escape helpers
- [x] Default problem titles (`Problem 1`, `Problem 2`, …)
- [x] Warnings emitted with `source` tag; empty choice flagged
- [x] `handleEdit` cross-field commit (no lost keystrokes)
- [x] 37-file `.docx` corpus stays within issue budget

Manual (browser):
- [ ] LaTeX equation editor — live preview and insertion
- [ ] Preview editing — formatting toolbar, warnings badge refresh
- [ ] File upload — `.txt` and `.docx`
- [ ] MathJax re-render after edits
- [ ] Library export `.tar.gz` imports into edX Studio
- [ ] OLX validation on Open edX platform

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Open edX community for OLX specifications
- Mammoth.js team for the Word document library
- All contributors and users

## 📞 Support

- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/yourusername/Problem-converter-new/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/yourusername/Problem-converter-new/discussions)
- 📧 **Contact:** your.email@example.com

## 📋 Detailed Changelog

### Version 5.x Series (Current)
**v5.0.0-alpha** — structural refactor + surfaced warnings
- Core logic extracted from `index.html` to `src/converter.js`.
- Node-based test suite under `test/` (48 regressions + docx corpus).
- `parseProblems` rewritten as a 16-handler state machine with a
  single `finalizeProblem` helper.
- Warnings panel + per-problem badges surface parser/validator issues
  that were previously only in `console.warn`.
- Parser/validator warnings tagged with `source` so the edit-refresh
  flow can preserve the parser ones.
- Emphasis-tag normalization, LaTeX `\mathbf{(A)}` choice splitting,
  Q-label detection, Greek/Cyrillic folding, multi-line question
  accumulation, math-period preservation, numerical-regex fix,
  placeholder-collision guard, href scheme whitelist, attribute
  escaping, clipboard fallback, download debounce, crypto UUIDs,
  Unicode-preserving filename, library metadata snapshot.
- **Library download is now `.tar.gz`** (POSIX tar + gzip via native
  `CompressionStream`) so edX Studio's Import Library accepts the
  archive directly. JSZip CDN dependency dropped.

### Version 4.x Series
**v4.3** - GitHub Pages cache refresh
**v4.2** - Fixed Answer format explanation handling
**v4.1** - Added markdown-style code snippet support (triple backticks)
**v4.0** - Intelligent checkbox detection for "(select all that apply)" phrases

### Version 3.x Series
**v3.9** - Added support for unprefixed choices
**v3.8** - **CRITICAL FIX:** Question setup text preservation after explanation
**v3.7** - Fixed stale questionEnded flag state
**v3.6** - Fixed bullet list rendering bug
**v3.5** - Comprehensive bug sweep and fixes
**v3.4** - Changed marker from 'end?' to 'endquestion' to avoid conflicts
**v3.3** - Added 'end?' marker for explicit question boundary marking
**v3.2** - Fixed 'End Explanation' to properly finalize problems
**v3.1** - Accumulate question setup between 'End Explanation' and choices
**v3.0** - Added 'End Explanation' marker support
**v2.9** - Added bullet point support and fixed explanation bleeding
**v2.8** - Protected \begin{center}...\end{center} LaTeX blocks
**v2.7** - Preserve line breaks in questions and explanations
**v2.6** - Enhanced line break handling

### Version 2.x Series (Foundation)
**v2.5** - Fixed library export with required url_name attributes
**v2.4** - LaTeX bracket preservation ([ and ] characters)
**v2.3** - Multi-line choice support with LaTeX math blocks
**v2.2** - Removed character limits for math wrapping in explanations
**v2.1** - Generated explicit summation symbols instead of subscripting
**v2.0** - Initial stable release with core functionality

### Critical Fixes Timeline
- **Choice Parsing:** Fixed 5+ issues with blank lines, prefixes, and multi-line content
- **LaTeX Handling:** Fixed 8+ issues with brackets, delimiters, and math block detection
- **Explanation Handling:** Fixed 6+ issues with bleeding, markers, and boundaries
- **Library Export:** Fixed 3+ issues with XML structure and required attributes
- **Parser Edge Cases:** Fixed 15+ edge cases in format detection and question parsing

## 🗺️ Roadmap

### Version 2.0 (Planned)
- [ ] Offline PWA support
- [ ] Import from existing OLX
- [ ] Problem templates library
- [ ] Collaborative editing
- [ ] Version control for problem sets

### Version 2.1 (Future)
- [ ] AI-assisted problem generation
- [ ] Accessibility improvements (WCAG 2.1 AA)
- [ ] Mobile-optimized interface
- [ ] Integration with Learning Management Systems

---

**Made with ❤️ for educators worldwide**

*Simplifying the creation of engaging educational content for the Open edX platform.*
