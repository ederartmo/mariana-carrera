(() => {
  const dialog = document.querySelector('[data-gallery-viewer]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const photos = [...document.querySelectorAll('[data-gallery-photo]')];
  const image = dialog.querySelector('img');
  const position = dialog.querySelector('[data-gallery-position]');
  const download = dialog.querySelector('[data-gallery-download]');
  let index = 0;
  let opener;
  function show(next) {
    index = (next + photos.length) % photos.length;
    const photo = photos[index];
    image.src = photo.href;
    image.alt = photo.querySelector('img').alt;
    position.textContent = `Foto ${index + 1} de ${photos.length}`;
    download.href = photo.href;
    download.download = photo.href.split('/').pop();
  }
  photos.forEach((photo, i) => photo.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); opener = photo; show(i); dialog.showModal();
  }));
  dialog.querySelector('[data-gallery-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-gallery-prev]').addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-gallery-next]').addEventListener('click', () => show(index + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { image.removeAttribute('src'); opener?.focus(); });
})();
