# Allmess Lager-Inventur

Mobile PWA zur Erfassung des Allmess-Restbestands im Lager per Barcode-Scan.
Läuft komplett offline auf dem Handy, Daten bleiben dauerhaft im Browser-
Speicher (IndexedDB) erhalten. Kein Server, keine Kosten.

## Installation auf GitHub Pages (kostenlos)

1. Neues **privates oder öffentliches** GitHub-Repository anlegen, z. B.
   `allmess-lager-inventur`.
2. Alle Dateien aus diesem Ordner direkt ins Hauptverzeichnis des Repos
   hochladen (nicht in einen Unterordner — sonst funktioniert `sw.js`
   nicht korrekt, gleiches Problem wie beim ersten Upload der Auftragsapp).
3. Im Repo unter **Settings → Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main`, Ordner `/ (root)`
   - Speichern.
4. Nach ein bis zwei Minuten ist die App erreichbar unter:
   `https://<dein-github-name>.github.io/allmess-lager-inventur/`
5. Diese URL auf dem Android-Handy im Chrome-Browser öffnen, dann über das
   Browser-Menü **„Zum Startbildschirm hinzufügen“** wählen — die App
   verhält sich danach wie eine normale App mit eigenem Icon.

HTTPS ist für den Kamera-Zugriff zwingend erforderlich — GitHub Pages
liefert das automatisch mit, ohne dass du dich darum kümmern musst.

## Hinweise

- **Barcode-Scan** nutzt die native Browser-Funktion (`BarcodeDetector`).
  Funktioniert auf aktuellem Chrome/Android zuverlässig. Falls dein Handy
  das nicht unterstützt, blendet die App automatisch das manuelle
  Eingabefeld für die Artikelnummer ein — die App bleibt voll nutzbar.
- **Daten bleiben lokal auf dem Handy.** Wird die App im Browser
  gelöscht/App-Daten geleert, gehen auch die Inventurdaten verloren.
  Deshalb: nach Abschluss der Lagerbegehung immer exportieren.
- **Export**: XLSX (Excel) und CSV, mit Artikelnummer, Bezeichnung,
  Kategorie, Eichjahr, Menge — direkt verschickbar an den Käufer.
- **Offline-Export**: Der XLSX-Export lädt einmalig eine kleine externe
  Bibliothek nach. Beim ersten Mal also möglichst mit Internet exportieren,
  danach funktioniert das dank Service-Worker-Cache auch offline. CSV
  funktioniert von Anfang an immer offline.

## Änderungen später einspielen

Einfach die geänderten Dateien im GitHub-Repo ersetzen (Upload oder
`git push`) — GitHub Pages aktualisiert automatisch. Bereits erfasste
Inventurdaten auf dem Handy bleiben davon unberührt.
