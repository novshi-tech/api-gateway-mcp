// HTML built with the `html` tag escapes every interpolated value unless it is
// itself Html, so a value can only reach the page as markup on purpose.
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type Content = Html | string | number | null | undefined | false | Content[];

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function render(content: Content): string {
  if (content === null || content === undefined || content === false) return "";
  if (content instanceof Html) return content.value;
  if (Array.isArray(content)) return content.map(render).join("\n");
  return escape(String(content));
}

export function html(strings: TemplateStringsArray, ...values: Content[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Html(out);
}
