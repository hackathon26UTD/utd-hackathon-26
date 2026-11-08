// One accessible wordmark across marketing, accounts and operations.
export const brandMarkup = '<span class="safehome-brand"><img class="safehome-brand-light" src="/assets/logo/homebeacon-wordmark-onlight.svg" width="176" height="56" alt="Safe Home"><img class="safehome-brand-dark" src="/assets/logo/homebeacon-wordmark-ondark.svg" width="176" height="56" alt="Safe Home"></span>';
export function brandNode() {
  const root = document.createElement('span');
  root.className = 'safehome-brand';
  for (const theme of ['light', 'dark']) {
    const img = document.createElement('img');
    img.className = `safehome-brand-${theme}`;
    img.src = `/assets/logo/homebeacon-wordmark-on${theme}.svg`;
    img.alt = 'Safe Home'; img.width = 176; img.height = 56;
    root.append(img);
  }
  return root;
}
