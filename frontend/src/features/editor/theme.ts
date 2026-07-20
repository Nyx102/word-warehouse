import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/* Doom-one editor theme on CSS custom properties. style-mod passes var()
 * through verbatim, so one extension serves both palettes: flipping
 * html[data-theme] recolors live editors with no reconfigure. The {dark}
 * flag is deliberately unused; every surface is specified here instead. */

const chrome = EditorView.theme({
  '&': {
    color: 'var(--fg)',
    backgroundColor: 'var(--bg)',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    fontFamily: 'var(--mono)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  // vim mode's block cursor (Prec.highest in @replit/codemirror-vim, default
  // #ff9696); Prec.highest here + registration before the keymap compartment
  // in baseExtensions lets this win instead. The letter color is set inline
  // by the vim plugin's JS (to the character's own syntax color), so it
  // needs !important to read as the on-accent contrast color instead.
  '.cm-fat-cursor': { background: 'var(--accent)', color: 'var(--on-accent) !important' },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none',
    outline: 'solid 1px var(--accent)',
    color: 'transparent !important',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--cm-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--cm-active-gutter)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-alt)',
    color: 'var(--fg-dim)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--mark-bg)',
    outline: '1px solid var(--warn)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-dim)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--accent-dim)',
    outline: '1px solid var(--accent)',
  },
  '.cm-panels': { backgroundColor: 'var(--bg-alt)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--raise)',
    border: '1px solid var(--border)',
    color: 'var(--fg-dim)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--raise)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
  },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: 'var(--border)' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: 'var(--raise)' },
});

/* Doom-one face table; the keyword/comment/variable flips for the light
 * palette happen in tokens.css, not here */
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-func)' },
  { tag: [t.standard(t.variableName), t.standard(t.propertyName), t.self], color: 'var(--syn-builtin)' },
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: 'var(--syn-string)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.constant(t.variableName), t.bool, t.atom, t.null], color: 'var(--syn-const)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: [t.comment, t.meta], color: 'var(--syn-comment)' },
  { tag: t.variableName, color: 'var(--syn-variable)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.tagName, color: 'var(--syn-keyword)' },
  { tag: t.attributeName, color: 'var(--syn-type)' },
  { tag: t.heading, color: 'var(--blue)', fontWeight: 'bold' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--cyan)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--err)' },
]);

export const doomTheme: Extension = [Prec.highest(chrome), syntaxHighlighting(highlight)];
