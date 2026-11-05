/**
 * Contact pictos (design system tokens/icons/contact.svg, "ContactPicto"): one per kind of contact handle, keyed by
 * `onb:ContactType onb:key`. 14px box, filled in currentColor. Copied from the design system's sprite; a kind
 * with no picto here shows the link one.
 */
export const CONTACT_ICONS: Record<string, string> = {
  email: `<path d="M1.5 3h11l-5.5 5L1.5 3zm-1 1v7.5c0 .3.2.5.5.5h12c.3 0 .5-.2.5-.5V4l-6.5 5.5L.5 4z"/>`,
  phone: `<path d="M3.3 1.5 5 1.3l1.1 2.9-1.3.9a7 7 0 0 0 4.1 4.1l.9-1.3 2.9 1.1-.2 1.7c-.1.6-.6 1-1.2 1A10.4 10.4 0 0 1 2.3 2.7c0-.6.4-1.1 1-1.2z"/>`,
  matrix: `<path d="M1 1.5h2.5v1.3H2.3v8.4h1.2v1.3H1zM13 1.5h-2.5v1.3h1.2v8.4h-1.2v1.3H13zM4.3 4.8h1.1v.6c.3-.4.8-.7 1.4-.7.6 0 1 .3 1.2.7.3-.4.8-.7 1.4-.7 1 0 1.5.6 1.5 1.7v3H9.8V6.6c0-.6-.2-.8-.6-.8s-.7.3-.7.8v2.8H7.4V6.6c0-.6-.2-.8-.6-.8s-.7.3-.7.8v2.8H4.3z"/>`,
  signal: `<path d="M7 1.5a5.5 5.5 0 0 0-4.8 8.2L1.5 12.5l2.9-.7A5.5 5.5 0 1 0 7 1.5zm0 1.4a4.1 4.1 0 1 1-2.2 7.6l-.3-.2-1 .3.3-1-.2-.3A4.1 4.1 0 0 1 7 2.9z"/>`,
  telegram: `<path d="M12.8 2.2 1.3 6.6c-.6.2-.6 1 0 1.2l2.8.9 1.1 3.4c.1.4.6.5.9.2l1.6-1.5 2.9 2.1c.4.3.9.1 1-.4l2-9.5c.1-.6-.4-1-.8-.8zM5.2 8.5l5.4-3.6-4.2 4.3-.3 1.9z"/>`,
  discord: `<path d="M11.6 3.2a10 10 0 0 0-2.5-.8l-.3.6a9 9 0 0 0-3.6 0l-.3-.6a10 10 0 0 0-2.5.8C.8 5.6.4 7.9.6 10.2a10 10 0 0 0 3 1.5l.6-1-1-.5.3-.2a7 7 0 0 0 7 0l.3.2-1 .5.6 1a10 10 0 0 0 3-1.5c.3-2.7-.4-5-1.8-7zM5.2 8.8c-.6 0-1-.5-1-1.2s.4-1.2 1-1.2 1 .6 1 1.2-.4 1.2-1 1.2zm3.6 0c-.6 0-1-.5-1-1.2s.4-1.2 1-1.2 1 .6 1 1.2-.4 1.2-1 1.2z"/>`,
  mattermost: `<path d="M8.7 1.5 6.2 5.6a1.6 1.6 0 1 0 2.8 1.6l.3-4.7zM5.6 2a5.4 5.4 0 1 0 5.6.5l-.1 1.6a4 4 0 1 1-5.8-.7z"/>`,
  link: `<path d="M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2.5l-.8.8.9.9.8-.8a1.2 1.2 0 0 1 1.7 1.7l-2 2a1.2 1.2 0 0 1-1.7 0zM8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 11.5l.8-.8-.9-.9-.8.8a1.2 1.2 0 0 1-1.7-1.7l2-2a1.2 1.2 0 0 1 1.7 0z"/>`,
};

export function contactPicto(key: string): string {
  const inner = CONTACT_ICONS[key] ?? CONTACT_ICONS.link;
  return `<svg class="ct-picto" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">${inner}</svg>`;
}
