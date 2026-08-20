// Empty stand-in for bambooo's optional heavy widget deps (OpenLayers, pdfjs-dist,
// jsvectormap, barcode-detector). They are referenced by bambooo's barrel but only
// used if those widgets are instantiated, which AudioMesh never does. Replacing the
// requests with this module (instead of IgnorePlugin, which throws "Cannot find
// module" at eval and crashes the whole SPA) yields a harmless empty object.
module.exports = {};
