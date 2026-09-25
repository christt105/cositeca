import { TELEGRAM_LINK_RE } from "./rules.js";
import { esc } from "./ui.js";

export function yearOf(result) {
  const date = result.release_date || result.first_air_date || "";
  return date.slice(0, 4);
}

export function nameOf(result) {
  return result.title || result.name || "";
}

export function seasonOptions(seasons) {
  const numbers = new Set(seasons.map((s) => s.season_number));
  const options = [];
  if (!numbers.has(0)) options.push({ value: 0, label: "Especiales (0)" });
  for (const s of [...seasons].sort((a, b) => a.season_number - b.season_number)) {
    options.push({ value: s.season_number, label: `${s.name} (${s.season_number})` });
  }
  options.push({ value: "all", label: "Serie completa (all)" });
  options.push({ value: "other", label: "Otra (escribir número)" });
  return options;
}

export function checkboxGroup(name, values, checkedValues = []) {
  return values
    .map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}"${checkedValues.includes(v) ? " checked" : ""}> ${esc(v)}</label>`)
    .join("");
}

/** Error message for a Telegram message link, or "" when it is empty or valid for one of `groups`. */
export function validateLink(link, groups) {
  if (!link) return "";
  if (link.includes("t.me/+") || link.includes("joinchat")) {
    return "Los links de invitación no valen, tiene que ser el link de un mensaje.";
  }
  const match = TELEGRAM_LINK_RE.exec(link);
  if (!match) {
    return "Tiene que ser https://t.me/c/<grupo>/<mensaje>, copiado con Copiar enlace.";
  }
  if (!Object.prototype.hasOwnProperty.call(groups, match[1])) {
    return "Ese link no es de ninguno de los grupos de la Cositeca.";
  }
  return "";
}
