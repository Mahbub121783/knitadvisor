/**
 * KnitAdvisor — the loop count, off the page's own thread.
 *
 * Measuring a photo takes a second or two of arithmetic (FFT autocorrelation
 * over several patches). Done on the page, it froze the camera preview and the
 * spinner while it ran, which reads as "the app hung". Here it runs beside the
 * page: the preview keeps moving and the result arrives as a message.
 *
 * After the measuring, the fabric recogniser (fabric-net.js, plain JavaScript)
 * looks at the same square of cloth and its answer joins the identification as
 * one more item of evidence. If it cannot load, the measured identification stands.
 *
 * Message in:  { id, buf (ArrayBuffer of RGBA), w, h, free: {pxPerMm, source, note} }
 * Message out: { id, r }  — the card measurement, or, with no card in the
 *              photo, the card-free one at the scale the page estimated.
 */
self.importScripts('fabric-scan-core.js?v=20261113b', 'fabric-net.js?v=20261113a');

var MODEL = '/assets/models/fabric-id-v1';
var netP = null;
function getNet() {
  if (!netP) netP = self.FabricNet.load(MODEL + '.json', MODEL + '.bin').catch(function () { return null; });
  return netP;
}
getNet();                                    // start fetching the weights while the first photo is taken

self.onmessage = function (e) {
  var d = e.data || {}, KS = self.KAScan, r, rgba;
  try {
    rgba = new Uint8ClampedArray(d.buf);
    // the camera saw no card in the live view: go straight to the card-free count
    r = d.skip_card && d.free ? { error: 'no card', code: 'no_card' } : KS.analysePhoto(rgba, d.w, d.h);
    if (r.error && r.code === 'no_card' && d.free) r = KS.analyseFree(rgba, d.w, d.h, d.free);
  } catch (err) {
    r = { error: 'This photo could not be measured: ' + (err && err.message || err) };
  }
  if (!r || r.error || !r._crop) { if (r) delete r._id; self.postMessage({ id: d.id, r: r }); return; }
  getNet().then(function (net) {
    if (net) {
      try {
        // one pass over the square of cloth the measuring read (about 0.3 s on a desktop, a second on a phone)
        var m = net.classify(rgba, d.w, d.h, [r._crop]);
        KS.reidentify(r, m);
      } catch (_) { /* the measured identification stands */ }
    }
    delete r._id;
    self.postMessage({ id: d.id, r: r });
  });
};
