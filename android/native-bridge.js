(function () {
  if (!window.EcoNative) return;
  // Route blob/data downloads (CSV, JSON exports) to Android's "Save to…" dialog.
  var origClick = HTMLAnchorElement.prototype.click;
  function save(a) {
    var name = a.getAttribute('download') || 'download';
    return fetch(a.href).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { var s = String(fr.result); window.EcoNative.saveFile(name, b.type || 'application/octet-stream', s.slice(s.indexOf(',') + 1)); res(); };
        fr.readAsDataURL(b);
      });
    });
  }
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^(blob|data):/.test(this.href)) { save(this); return; }
    return origClick.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && /^(blob|data):/.test(a.href)) { e.preventDefault(); save(a); }
  }, true);
  // "Save as PDF" → Android print dialog (Save as PDF / printer).
  window.print = function () { window.EcoNative.print(document.title || 'EcoCypher report'); };
})();
