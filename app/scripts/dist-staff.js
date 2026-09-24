// Personel kurulum dosyasini uretir: varyanti 'staff' yapar, derler, sonra
// (build basarisiz olsa bile) varyanti 'customer'a geri alir - repoda ve
// sonraki "npm run dist" icin varsayilan hep musteri kalir.
//
// Eskiden bu package.json'da "a && b & c" seklindeydi: 'c' her durumda
// calisiyor ama cikis kodu 'c'nin oluyordu, yani derleme basarisiz olsa bile
// komut basarili gorunuyordu. Burada cikis kodu DERLEMENIN cikis kodudur.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
function run(command) {
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  return result.status === null ? 1 : result.status;
}

let code = run('node scripts/set-variant.js staff');
if (code === 0) {
  code = run('electron-builder --win -c.win.artifactName=${productName}-Personel-Setup-${version}.${ext}');
}
run('node scripts/set-variant.js customer');
process.exit(code);
