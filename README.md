# Open edX OLX Problem Converter

A powerful, browser-based tool for converting educational problem sets into Open edX OLX (Open Learning XML) format. This application streamlines the process of creating course content for the Open edX platform, supporting multiple question types and rich text formatting.

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
- All formatting preserved in OLX output

### Advanced Capabilities
- 📁 **File Upload Support** - Import from .txt or .docx files
- 🔄 **Live Preview** - Real-time problem rendering
- ✏️ **In-Place Editing** - Edit questions, choices, and explanations directly
- 📊 **Statistics Dashboard** - Track problem counts and warnings
- 📦 **Batch Processing** - Convert multiple problems at once
- 💾 **Library Export** - Download as organized ZIP with course structure
- 📋 **Copy to Clipboard** - Quick OLX export
- 🎨 **Modern UI** - Clean, responsive design

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

### Metadata (Optional)

Add metadata at the beginning of your input:

```
Organization: MyUniversity
Legacy Library Name: Math 101 Problems
Library ID: MATH101_PROBLEMS
Label: Week 1 Quiz

[Your problems here...]
```

### File Upload

**Supported Formats:**
- `.txt` - Plain text files
- `.docx` - Microsoft Word documents

The converter automatically extracts and processes formatting from Word documents.

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
   - **Download Library** - Get complete course structure as ZIP

## 📊 Statistics & Validation

The built-in statistics panel shows:
- Total problem count
- Breakdown by type (MC, Multi-select, Numerical, Text)
- Average choices per problem
- ⚠️ **Warnings** for:
  - Problems with no correct answer marked
  - Problems with insufficient choices

## 🔧 Technical Details

### Technology Stack
- **Frontend Only** - No backend required
- **Pure HTML/CSS/JavaScript** - No build process needed
- **Dependencies:**
  - JSZip v3.10.1 - ZIP file generation
  - Mammoth.js v1.6.0 - Word document parsing
  - Google Fonts - Typography

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
├── index.html          # Complete single-page application
├── README.md          # This file
└── LICENSE            # MIT License
```

The entire application is contained in a single, self-contained HTML file for maximum portability.

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
- Complex mathematical equations require manual LaTeX formatting
- Images must be added manually after export
- No support for adaptive/conditional problems

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

- [ ] LaTeX equation editor integration
- [ ] Image upload support
- [ ] Additional problem types (drag-and-drop, etc.)
- [ ] Template system for custom formats
- [ ] Internationalization (i18n)

### Development

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly across browsers
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Open edX community for OLX specifications
- JSZip and Mammoth.js teams for excellent libraries
- All contributors and users

## 📞 Support

- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/yourusername/Problem-converter-new/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/yourusername/Problem-converter-new/discussions)
- 📧 **Contact:** your.email@example.com

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
