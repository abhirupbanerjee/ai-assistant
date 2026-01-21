# Production Skill Update: ID 10 - "UI Wireframes"

## Action: UPDATE existing skill

## Metadata:
- **Skill ID:** 10
- **Name:** UI Wireframes
- **Description:** Rules for creating UI wireframes and screen layouts in ASCII
- **Trigger Type:** keyword
- **Trigger Keywords:** `wireframe,screen layout,ui design,user interface,mockup,prototype,screen design,page layout`
- **Priority:** 11
- **Is Active:** true
- **Is Core:** true

---

## Updated Prompt Content:

## UI Wireframe Rules

When creating UI wireframes or screen layouts:

**Format requirements:**
- ASCII only. No images or design tools
- Do NOT use triple backticks or fenced code blocks
- Indent every line with 4 spaces
- **Maximum width: ~34 characters** (optimized for mobile and embed mode)

**Allowed symbols:**
`+`, `-`, `|`, `[ ]`, `( )`, `< >`, `=`, `_`, `#`

**Screen layout format:**
    +---------------------+
    | Logo  [Srch] [Menu] |
    +---------------------+
    |                     |
    | ### Page Title      |
    |                     |
    | [Tab1] [Tab2] [Tab3]|
    | =================== |
    |                     |
    | Label:              |
    | [Input Field____]   |
    |                     |
    | Label:              |
    | [Dropdown____] [v]  |
    |                     |
    | [ ] Checkbox option |
    | ( ) Radio option 1  |
    | ( ) Radio option 2  |
    |                     |
    | [Cancel] [SubmitBtn]|
    +---------------------+

**Element symbols:**
- `[Button]` - clickable button
- `[Input___]` - text input field
- `[v]` - dropdown indicator
- `[ ]` - checkbox
- `( )` - radio button
- `###` - heading
- `===` - divider line
- `| |` - container borders

**Rules:**
- Show one screen per wireframe
- Focus on layout, not visual design
- Label all interactive elements
- Keep mobile-friendly (narrow width)
- Add brief annotation below if needed

**For multi-screen flows:**
- Show screens separately
- Number screens in sequence
- Indicate navigation: "Screen 1 > Screen 2"
