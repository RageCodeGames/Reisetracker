# Reisetracker

Kleine Seite fürs Handy: sie zeigt, wo eine Reise laut Plan gerade steht. Es gibt keine Live-Daten, keinen Server und keine Uploads. Die Seite besteht aus HTML, CSS und JavaScript und läuft so auf GitHub Pages. Einmal geöffnet, bleibt sie auch ohne Netz nutzbar.

## Datenschutz

Das Repository ist öffentlich. Reisedaten dürfen dort nur verschlüsselt liegen.

- Klartext nur in `privat/`. Dieser Ordner steht in `.gitignore` und wird nicht hochgeladen.
- Die Seite liest nur `daten/*.enc.json`.
- `config.json` enthält das Salt. Das ist kein Geheimnis. Das Familien-Passwort steht nirgends in den Dateien.
- Im Browser wird nur der abgeleitete Schlüssel gemerkt, nie das Passwort. „Abmelden“ löscht ihn auf diesem Gerät.

## Neue Reise anlegen

1. In `privat/index.json` einen Eintrag mit `id`, `titel`, `von` und `bis` ergänzen.
2. Ordner `privat/<irgendwas>/` anlegen und dort `trip.json` schreiben. Die `id` in der Datei muss zum Index passen.
3. Verschlüsseln:

```bash
node tools/verschluesseln.mjs
```

Das Passwort wird zweimal verdeckt abgefragt. Danach liegen `daten/index.enc.json` und je Reise `daten/<id>/trip.enc.json` bereit. Dateien in `privat/` bleiben unverändert.

4. Die neuen Dateien in `daten/` committen, **nicht** `privat/`.

Wenn sich eine Reise ändert: Klartext nur in `privat/` anpassen, das Skript erneut ausführen, danach die Dateien in `daten/` committen.

## Lokal ansehen

Die Seite nicht per Doppelklick öffnen. Als Datei (`file://`) laden Module und Daten nicht.

In Cursor die Erweiterung **Live Server** nutzen und `index.html` darüber öffnen. Der Serverstamm muss dieser Projektordner sein, damit `./js/`, `./daten/` und `./config.json` nebeneinander liegen.

Zum Prüfen einer Uhrzeit an die Adresse hängen:

```text
?zeit=2026-06-01T14:00
```

Ohne Zeitzone gilt die Ortszeit des Geräts. Oben erscheint ein gelber Hinweis **Testzeit**. So lassen sich Ankunft, Hotel, Seetag und die Zeit danach durchspielen, ohne zu warten.

## App aufs Handy legen

Nach dem Hochladen auf GitHub Pages (Ordner `/reisetracker/`):

**iPhone:** Safari öffnen → Teilen → **Zum Home-Bildschirm**.

**Android:** Chrome öffnen → Menü (drei Punkte) → **App installieren**.

Icons neu erzeugen: `tools/icon-generator.html` über Live Server öffnen und je Größe den Download-Knopf nutzen. Die PNGs nach `icons/` legen.

## Vor dem Commit

- `git status` zeigt nichts aus `privat/`.
- In `daten/` stehen nur die verschlüsselten Dateien. Darin dürfen keine Ortsnamen und keine Zeiten aus dem Plan im Klartext stehen, nur `v`, `iv` und `daten`.
- Weder im Code noch in `config.json` steht das Passwort.
- `config.json` mit dem Salt darf mit ins Repository. Die verschlüsselten Dateien auch. `privat/` nicht.
