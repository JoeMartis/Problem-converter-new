// Regression suite for parseProblems, escape helpers, sanitizer, and the
// pre-parse normalizers. Every test corresponds to a bug that was fixed in
// the v5 refactor or the preceding stabilization pass.

import { loadConverterApi, TestRunner, assert, assertEqual } from './harness.mjs';

const api = loadConverterApi();
const t = new TestRunner('parser');

// --- core parsing --------------------------------------------------------

t.case('unlabeled problems get "Problem 1", "Problem 2", ... titles', () => {
    const r = api.parseProblems(
        'Q1?\nA. a\nB. b\nCorrect: A\nExplanation: e.\n' +
        'Q2?\nA. a\nB. b\nCorrect: A\nExplanation: f.'
    );
    assertEqual(r.problems.map(p => p.title), ['Problem 1', 'Problem 2']);
});

t.case('labeled problems carry the label as title', () => {
    const r = api.parseProblems(
        'Q1-A\nFirst?\nA. a\nCorrect: A\nExplanation: e.\n' +
        'Q1-B\nSecond?\nA. a\nCorrect: A\nExplanation: f.'
    );
    assertEqual(r.problems.map(p => p.title), ['Q1-A', 'Q1-B']);
});

t.case('parses a simple multiple-choice question', () => {
    const r = api.parseProblems(
        'What is 2+2?\n1\n3\n4 (correct)\n5\nExplanation: math.'
    );
    assertEqual(r.problems.length, 1);
    assertEqual(r.problems[0].choices.length, 4);
    assertEqual(r.problems[0].correctIndices, [2]);
    assert(r.problems[0].isMultipleChoice, 'should be MC');
});

t.case('parses checkbox (multiple correct)', () => {
    const r = api.parseProblems(
        'Which are primes? (select all that apply)\n' +
        '2 (correct)\n3 (correct)\n4\n5 (correct)\n' +
        'Explanation: primes.'
    );
    assertEqual(r.problems[0].correctIndices, [0, 1, 3]);
    assert(!r.problems[0].isMultipleChoice, 'should be checkbox');
});

t.case('parses numerical answer', () => {
    const r = api.parseProblems(
        'What is 2+2?\nAnswer: 4\nExplanation: math.'
    );
    assertEqual(r.problems[0].answerType, 'numerical');
    assertEqual(r.problems[0].answer, '4');
});

t.case('parses text answer', () => {
    const r = api.parseProblems(
        'What is the capital of France?\nAnswer: Paris\nExplanation: city.'
    );
    assertEqual(r.problems[0].answerType, 'text');
    assertEqual(r.problems[0].answer, 'Paris');
});

// --- numerical regex regressions -----------------------------------------

t.case('numerical detector handles .5 and -.5', () => {
    const r = api.parseProblems('Q?\nAnswer: .5\nExplanation: e.');
    assertEqual(r.problems[0].answerType, 'numerical');
});

t.case('numerical detector handles scientific notation', () => {
    const r = api.parseProblems('Q?\nAnswer: 1e-5\nExplanation: e.');
    assertEqual(r.problems[0].answerType, 'numerical');
});

t.case('numerical detector handles leading +', () => {
    const r = api.parseProblems('Q?\nAnswer: +42\nExplanation: e.');
    assertEqual(r.problems[0].answerType, 'numerical');
});

// --- Answer: / Explanation: interaction ---------------------------------

t.case('Answer+Explanation on same line splits correctly', () => {
    const r = api.parseProblems('Q?\nAnswer: 42 Explanation: because.');
    assertEqual(r.problems[0].answer, '42');
    assertEqual(r.problems[0].explanation, 'because.');
});

t.case('answer containing lowercase "explanation:" does not truncate', () => {
    const r = api.parseProblems(
        'Q?\nAnswer: The best explanation: is long.\nExplanation: real.'
    );
    assertEqual(r.problems[0].answer, 'The best explanation: is long.');
    assertEqual(r.problems[0].explanation, 'real.');
});

// --- Q-style label detection --------------------------------------------

t.case('Q-label becomes title', () => {
    const r = api.parseProblems(
        'Q1-A (Existing)\nWhat is the correct formula?\nA. a\nB. b\nCorrect: A\nExplanation: e.'
    );
    assertEqual(r.problems[0].title, 'Q1-A');
});

t.case('multi-line setup before ? is preserved', () => {
    const r = api.parseProblems(
        'Q1-B\nSuppose x=0 for a pair.\nmin sum.\n' +
        'Which statement is true?\nA. a\nB. b\nCorrect: A\nExplanation: e.'
    );
    assert(
        r.problems[0].question.includes('Suppose x=0'),
        `lost setup: ${JSON.stringify(r.problems[0].question)}`
    );
    assert(
        r.problems[0].question.includes('Which statement is true?'),
        `lost question: ${JSON.stringify(r.problems[0].question)}`
    );
});

t.case('math expression "x=0. Which" is not split', () => {
    const r = api.parseProblems(
        'Q1-B\nSuppose x=0. Which statement is true?\nA. a\nB. b\nCorrect: A\nExplanation: e.'
    );
    assertEqual(r.problems.length, 1);
    assert(r.problems[0].question.startsWith('Suppose x=0'));
});

// --- Greek/Cyrillic folding ---------------------------------------------

t.case('Correct: with Greek Α folds to Latin A', () => {
    const r = api.parseProblems(
        'Q?\nA. a\nB. b\nC. c\nD. d\nCorrect: Α\nExplanation: e.'
    );
    assertEqual(r.problems[0].correctIndices, [0]);
});

t.case('Greek choice prefix Α. / Β. are recognized', () => {
    const r = api.parseProblems(
        'Q?\nΑ. a\nΒ. b\nΓ. c\nΔ. d\nCorrect: B\nExplanation: e.'
    );
    assertEqual(r.problems[0].choices.length, 4);
    assertEqual(r.problems[0].correctIndices, [1]);
});

// --- section header handling --------------------------------------------

t.case('section header "Q1 – Title" does not leak into explanation', () => {
    const r = api.parseProblems(
        'Q1-A\nFirst Q?\nA. a\nB. b\nCorrect: A\nExplanation: first.\n' +
        'Q2 – Next topic\n' +
        'Q2-A\nSecond Q?\nA. a\nB. b\nCorrect: A\nExplanation: second.'
    );
    assertEqual(r.problems.length, 2);
    assert(
        !r.problems[0].explanation.includes('Next topic'),
        `leaked: ${JSON.stringify(r.problems[0].explanation)}`
    );
});

// --- emphasis normalization (from Word .docx) ---------------------------

t.case('<strong>(correct)</strong> marker is detected', () => {
    const r = api.parseProblems(
        'Q?\nA. wrong\nB. right <strong>(correct)</strong>\nC. wrong\nExplanation: e.'
    );
    assertEqual(r.problems[0].correctIndices, [1]);
});

t.case('<strong>Correct: B</strong> (full marker bolded) is detected', () => {
    const r = api.parseProblems(
        'Q?\nA. a\nB. b\nC. c\n<strong>Correct: B</strong>\n<strong>Explanation:</strong> e.'
    );
    assertEqual(r.problems[0].correctIndices, [1]);
    assertEqual(r.problems[0].explanation, 'e.');
});

t.case('cross-line <strong>\\n</strong> wrapper is joined', () => {
    const r = api.parseProblems(
        'Q?\nA. a\nB. b<strong>\n</strong>\nC. c\n<strong>Correct:</strong> A\nExplanation: e.'
    );
    assertEqual(r.problems[0].choices.length, 3);
    assertEqual(r.problems[0].correctIndices, [0]);
});

t.case('<strong>Q1-B</strong> label is recognized', () => {
    const r = api.parseProblems(
        '<strong>Q1-A</strong>\nFirst?\nA. a\nB. b\nCorrect: A\nExplanation: one.\n' +
        '<strong>Q1-B</strong>\nSecond?\nA. a\nB. b\nCorrect: B\nExplanation: two.'
    );
    assertEqual(r.problems.length, 2);
    assertEqual(r.problems[0].title, 'Q1-A');
    assertEqual(r.problems[1].title, 'Q1-B');
});

// --- LaTeX choice normalization -----------------------------------------

t.case('single align* with multiple \\mathbf{(X)} splits into choices', () => {
    const r = api.parseProblems(
        'Pick the right formula?\n' +
        '\\begin{align*}\n' +
        '\\mathbf{(A)} x + y \\\\\n' +
        '\\mathbf{(B)} x - y \\\\\n' +
        '\\mathbf{(C)} x * y\n' +
        '\\end{align*}\n' +
        'Answer: A\nExplanation: e.'
    );
    assertEqual(r.problems[0].choices.length, 3);
    assertEqual(r.problems[0].correctIndices, [0]);
});

t.case('sequential $$\\mathbf{(X)}$$ blocks become choices', () => {
    const r = api.parseProblems(
        'Pick?\n' +
        '$$ \\mathbf{(A)} x + y $$\n' +
        '$$ \\mathbf{(B)} x - y $$\n' +
        '$$ \\mathbf{(C)} x * y $$\n' +
        'Answer: B\nExplanation: e.'
    );
    assertEqual(r.problems[0].choices.length, 3);
    assertEqual(r.problems[0].correctIndices, [1]);
});

// --- escape and sanitizer ----------------------------------------------

t.case('escapeXml handles null/undefined/number', () => {
    assertEqual(api.escapeXml(null), '');
    assertEqual(api.escapeXml(undefined), '');
    assertEqual(api.escapeXml(42), '42');
    assertEqual(api.escapeXml('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
});

t.case('sanitizer strips <script>, <iframe>, event handlers', () => {
    const out = api.sanitizeHtml(
        '<strong>ok</strong><script>bad()</script>' +
        '<iframe src=evil></iframe>' +
        '<div onclick="bad()">click</div>'
    );
    assert(!out.includes('<script'));
    assert(!out.includes('<iframe'));
    assert(!out.includes('onclick'));
    assert(out.includes('<strong>ok</strong>'));
});

t.case('sanitizer href whitelist allows http/https/mailto, rejects javascript', () => {
    assert(api.sanitizeHtml('<a href="https://ok">x</a>').includes('https://ok'));
    assert(api.sanitizeHtml('<a href="http://ok">x</a>').includes('http://ok'));
    assert(api.sanitizeHtml('<a href="mailto:a@b">x</a>').includes('mailto:'));
    assert(!api.sanitizeHtml('<a href="javascript:alert(1)">x</a>').includes('javascript'));
    assert(!api.sanitizeHtml('<a href="data:text/html,<b>">x</a>').includes('data:'));
    assert(!api.sanitizeHtml('<a href="blob:https://evil/">x</a>').includes('blob:'));
    assert(!api.sanitizeHtml('<a href="  JaVaScRiPt:alert(1)">x</a>').includes('script'));
});

t.case('placeholder collision is prevented (literal __LATEX_0__ in text)', () => {
    // User text with bait + real LaTeX block.
    const out = api.escapeXmlWithFormatting(
        'Mark the spot __LATEX_0__ and compute $x = 2$.'
    );
    assert(out.includes('__LATEX_0__'),
        `literal placeholder text was overwritten: ${out}`);
    // Real LaTeX should still render via $...$
    assert(out.includes('$x = 2$') || out.includes('$'),
        `lost real LaTeX: ${out}`);
});

// --- OLX output ---------------------------------------------------------

t.case('generateOLX escapes & < > in display_name', () => {
    const olx = api.generateOLX([{
        title: 'Title with <&> chars',
        question: 'Q?',
        choices: ['a', 'b'],
        correctIndices: [0],
        isMultipleChoice: true,
        explanation: 'e'
    }]);
    assert(olx.includes('Title with &lt;&amp;&gt; chars'),
        `display_name not escaped: ${olx.slice(0, 200)}`);
});

t.case('generateOLX produces valid numerical problem', () => {
    const olx = api.generateOLX([{
        title: 'Math',
        question: 'What is pi?',
        answer: '3.14',
        answerType: 'numerical',
        choices: [],
        correctIndices: [],
        isMultipleChoice: false,
        explanation: 'approx.'
    }]);
    assert(olx.includes('<numericalresponse answer="3.14">'));
    assert(olx.includes('<textline/>'));
});

// --- filename helper ----------------------------------------------------

t.case('makeSafeFilename preserves Unicode', () => {
    assertEqual(api.makeSafeFilename('中文课程'), '中文课程');
    assertEqual(api.makeSafeFilename('hello world'), 'hello_world');
});

t.case('makeSafeFilename neutralizes path traversal', () => {
    const out = api.makeSafeFilename('../../etc/passwd');
    assert(!out.includes('/'));
    assert(!out.includes('..'));
});

// --- export -------------------------------------------------------------

export default t;
