/**
 * KnitAdvisor — the loop count, off the page's own thread.
 *
 * Measuring a photo takes a second or two of arithmetic (FFT autocorrelation
 * over several patches). Done on the page, it froze the camera preview and the
 * spinner while it ran, which reads as "the app hung". Here it runs beside the
 * page: the preview keeps moving and the result arrives as a message.
 *
 * Message in:  { id, buf (ArrayBuffer of RGBA), w, h, free: {pxPerMm, source, note} }
 * Message out: { id, r }  — the card measurement, or, with no card in the
 *              photo, the card-free one at the scale the page estimated.
 */
self.importScripts('fabric-scan-core.js?v=20261112b');

self.onmessage = function (e) {
  var d = e.data || {}, KS = self.KAScan, r;
  try {
    var rgba = new Uint8ClampedArray(d.buf);
    // the camera saw no card in the live view: go straight to the card-free count
    r = d.skip_card && d.free ? { error: 'no card', code: 'no_card' } : KS.analysePhoto(rgba, d.w, d.h);
    if (r.error && r.code === 'no_card' && d.free) r = KS.analyseFree(rgba, d.w, d.h, d.free);
  } catch (err) {
    r = { error: 'This photo could not be measured: ' + (err && err.message || err) };
  }
  self.postMessage({ id: d.id, r: r });
};
