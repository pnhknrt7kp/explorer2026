/*
 * ExplorerFlipbook settings.
 *
 * This is the only file you may ever need to edit. It is plain text — open it
 * in Notepad or TextEdit, change the values between the quotes, and save.
 * Keep the quotes, colons and commas exactly where they are.
 */
window.FLIPBOOK_CONFIG = {
  // Shown in the toolbar and as the browser tab title.
  title: 'The Explorer 2025',

  // Where the PDF lives, relative to this folder. To publish a new edition,
  // replace assets/document.pdf and leave this line alone.
  pdfPath: 'assets/document.pdf',

  // Optional. Leave as '' to let readers download the PDF above.
  // To send them to Google Drive instead, paste the share link here.
  downloadUrl: '',

  // Caps page image resolution on high-density screens. 2 is a good balance of
  // sharpness and memory. Raise to 3 only if pages look soft on a large monitor.
  maxRenderScale: 2,
};
