/**
 * Shared HTML/JS escaping helpers for the panel's template-literal rendering.
 *
 * Every render module in this panel builds markup as a template literal and
 * assigns it to `innerHTML`. Any value that originates outside the module -
 * a zone name, a schedule name, a start time, an entity id, a sensor unit -
 * must therefore be escaped for the context it lands in. There is exactly one
 * copy of these helpers; do not reimplement them per file.
 *
 * Values that are provably numeric at the point of use (ids run through
 * `parseInt`, local arithmetic, array indexes) are left unescaped on purpose,
 * because escaping a number adds noise without closing anything.
 */

/** Characters that must not reach the HTML parser as markup. */
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 *
 * `&` is replaced first by virtue of the single-pass regex, so output is never
 * double-escaped. Both quote characters are covered, which is what makes this
 * safe inside `attr="${...}"` as well as in element text - an unescaped `"`
 * would otherwise close the attribute and let the rest of the value inject new
 * attributes such as `onfocus=`.
 *
 * @param {*} value - Any value; null/undefined become the empty string.
 * @returns {string} The escaped string, safe for HTML text and quoted attrs.
 * @example escapeHtml('<img src=x onerror=alert(1)>')
 *   // '&lt;img src=x onerror=alert(1)&gt;'
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Encode a value as a literal argument for an inline event handler.
 *
 * NOT interchangeable with escapeHtml. An `onclick="fn('${v}')"` attribute is
 * entity-decoded by the HTML parser BEFORE its contents are compiled as
 * JavaScript, so HTML-escaping alone does not contain a value there: `&#39;`
 * decodes back to `'` and still closes the JS string. Encoding as JSON first
 * (which escapes backslashes, quotes and control characters) and HTML-escaping
 * that result round-trips exactly - the parser hands JavaScript a well-formed
 * literal and nothing can break out.
 *
 * The call site must NOT wrap this in its own quotes; the JSON encoding
 * supplies them.
 *
 * @param {*} value - Any JSON-serialisable value (typically a string id).
 * @returns {string} An HTML-attribute-safe JavaScript literal.
 * @example `onclick="fn(${jsArg("a');alert(1)//")})"`
 *   // onclick="fn(&quot;a&#39;);alert(1)//&quot;)"  -> one string argument
 */
export function jsArg(value) {
  return escapeHtml(JSON.stringify(value === undefined ? null : value));
}
