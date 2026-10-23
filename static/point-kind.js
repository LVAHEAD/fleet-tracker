/*
Fleet ETA Tracker — именные плашки (v3.195): значок вместо букв L/O у особых точек. Только вид, клик по плашке не меняется.
  «B» — граница / проездная точка (слова из TRANSIT_WORDS сервера), домик — База (Baza Parking),
  якорь — порт (Type = port), печать — брокерский таможенный офис (Type = customs).
  Рисует CSS по атрибуту data-ptk на кнопке .lo-btn (style.css).
*/
const PTK_TRANSIT = /border|grense|grenze|tull|zoll|customs|граница/i;
const PTK_BASE = ["bazaparking", "baza", "база"];
function ptkNorm(s) { return String(s || "").toLowerCase().replace(/[\s\-]/g, ""); }

// name — текст точки в таблице, address — запись адресной базы (из расчёта), если есть
function pointKind(name, address) {
  const names = [name, address && address.name];
  if (names.some((n) => PTK_TRANSIT.test(String(n || "")))) return "B";
  if (names.some((n) => PTK_BASE.includes(ptkNorm(n)))) return "home";
  const t = address && address.type;
  return t === "port" ? "port" : t === "customs" ? "cust" : "";
}
function ptkAttr(kind) { return kind ? ` data-ptk="${kind}"` : ""; }
function setPtk(btn, kind) {
  if (!btn) return;
  if (kind) btn.dataset.ptk = kind; else delete btn.dataset.ptk;
}
