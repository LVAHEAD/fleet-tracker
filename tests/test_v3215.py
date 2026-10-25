"""v3.215: разметка комментария (как в WhatsApp): *жирный*, _курсив_, цвета {r:…} / {b:…}.
Гоняет чистые функции из static/row-comments.js под node: текст → HTML, DOM редактора → текст, копирование без цветов."""
import json
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const a = src.indexOf('const COM_COLORS'), b = src.indexOf('function placeFloat(');
const stubs = `const escapeHtml = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");`;
vm.runInThisContext(stubs + src.slice(a, b) + "\n;globalThis.__api = { comMdToHtml, comPlain, comEditorToMd };");
const f = globalThis.__api;
const T = (v) => ({ nodeType: 3, nodeValue: v });
const E = (name, kids, extra) => Object.assign({ nodeType: 1, nodeName: name, childNodes: kids || [], style: {}, getAttribute() { return ""; } }, extra || {});
const font = (hex, kids) => E('FONT', kids, { getAttribute: (n) => (n === 'color' ? hex : '') });
const out = {};
out.html = [
  f.comMdToHtml('*Паром* 30km'), f.comMdToHtml('_курс_ и *жир*'), f.comMdToHtml('{r:срочно} ok'),
  f.comMdToHtml('1 * 2 * 3'), f.comMdToHtml('OI_1779_x'), f.comMdToHtml('<script>*a*</script>'), f.comMdToHtml('*{r:a}*'),
];
out.plain = f.comPlain('*a* {r:b} {b:c}');
out.ed1 = f.comEditorToMd(E('DIV', [T('a '), E('B', [T('bold ')]), font('#d93025', [T('red')]), E('DIV', [T('line2')])]));
out.ed2 = f.comEditorToMd(E('DIV', [T('a'), E('DIV', [E('BR')]), E('DIV', [T('b')])]));
out.ed3 = f.comEditorToMd(E('DIV', [font('#d93025', [T('x '), font('#2f6fd6', [T('y')]), T(' z')])]));
out.ed4 = f.comEditorToMd(E('DIV', [font('#222222', [T('чёрный')]), E('I', [T('кур'), E('B', [T('сив')])])]));
out.ed5 = f.comEditorToMd(E('DIV', [T('текст'), E('BR'), T('ещё')]));
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "нет node")
class ComMarkupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run([NODE, "-e", DRIVER, os.path.join(ROOT, "static", "row-comments.js")],
                             capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise RuntimeError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_md_to_html(self):
        h = self.r["html"]
        self.assertEqual(h[0], "<b>Паром</b> 30km")
        self.assertEqual(h[1], "<i>курс</i> и <b>жир</b>")
        self.assertIn('<span style="color:#d93025">срочно</span>', h[2])
        self.assertEqual(h[3], "1 * 2 * 3")        # звёздочки с пробелами и цифрами — не разметка
        self.assertEqual(h[4], "OI_1779_x")          # подчёркивания внутри слова — не курсив
        self.assertNotIn("<script", h[5])            # чужой HTML экранируется
        self.assertIn("<b>", h[6])

    def test_plain_for_whatsapp(self):
        self.assertEqual(self.r["plain"], "*a* b c")

    def test_editor_to_md(self):
        self.assertEqual(self.r["ed1"], "a *bold* {r:red}\nline2")
        self.assertEqual(self.r["ed2"], "a\n\nb")
        self.assertEqual(self.r["ed5"], "текст\nещё")

    def test_nested_color_inner_wins(self):
        s = self.r["ed3"]
        self.assertIn("{b:y}", s)
        self.assertNotIn("{r:x {", s)

    def test_black_no_tag_and_italic_bold(self):
        self.assertEqual(self.r["ed4"], "чёрный_кур*сив*_")


if __name__ == "__main__":
    unittest.main()
