// app/variant.js dosyasini istenen varyanta ('customer' ya da 'staff')
// ayarlar - build oncesi package.json'daki "dist"/"dist:staff" tarafindan
// cagirilir. Kullanim: node scripts/set-variant.js customer|staff
const fs = require('fs');
const path = require('path');

const variant = process.argv[2];
if (variant !== 'customer' && variant !== 'staff') {
  console.error(`Gecersiz varyant: ${variant} (bekleniyor: customer|staff)`);
  process.exit(1);
}

const outPath = path.join(__dirname, '..', 'variant.js');
const content = `// Bu dosya build sirasinda otomatik yazilir (bkz. scripts/set-variant.js,
// package.json'daki "dist"/"dist:staff" komutlari) - elle degistirmeyin.
// 'customer' (varsayilan, herkese acik indirme linki): sadece "Destek Almak
// Icin" rolu gorunur. 'staff' (personele ozel, ayri kurulum dosyasi):
// "Destek Vermek Icin" rolu de gorunur.
window.NEXUSON_VARIANT = '${variant}';
`;
fs.writeFileSync(outPath, content, 'utf8');
console.log(`variant.js -> '${variant}' olarak ayarlandi.`);
