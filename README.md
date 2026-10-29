# Reisetracker

Kleine Seite fürs Handy: sie zeigt, wo eine Reise laut Plan gerade steht. Es gibt keine Live-Daten, keinen Server und keine Uploads. Die Seite besteht aus HTML, CSS und JavaScript und läuft so auf GitHub Pages.

## Datenschutz

Das Repository ist öffentlich. Reisedaten dürfen dort nur verschlüsselt liegen.

- Klartext nur in `privat/`. Dieser Ordner steht in `.gitignore` und wird nicht hochgeladen.
- Die Seite liest nur `daten/*.enc.json`.
- `config.json` enthält das Salt. Das ist kein Geheimnis. Das Familien-Passwort steht nirgends in den Dateien.
- Im Browser wird nur der abgeleitete Schlüssel gemerkt, nie das Passwort. „Abmelden“ löscht ihn auf diesem Gerät.

## Verschlüsseln

Node 20 oder neuer, im Projektordner:

```bash
node tools/verschluesseln.mjs
```

Das Passwort wird zweimal verdeckt abgefragt. Danach liegen `daten/index.enc.json` und je Reise `daten/<id>/trip.enc.json` bereit. Dateien in `privat/` bleiben unverändert.

Wenn sich eine Reise ändert: Klartext nur in `privat/` anpassen, das Skript erneut ausführen.

## Lokal ansehen

Die Seite nicht per Doppelklick öffnen. Als Datei (`file://`) laden Module und Daten nicht.

In Cursor die Erweiterung **Live Server** nutzen und `index.html` darüber öffnen. Der Serverstamm muss dieser Projektordner sein, damit `./js/`, `./daten/` und `./config.json` nebeneinander liegen.

Zum Prüfen einer Uhrzeit an die Adresse hängen:

```text
?zeit=2026-06-01T14:00
```

Ohne Zeitzone gilt die Ortszeit des Geräts. Oben erscheint ein gelber Hinweis **Testzeit**.

## Vor dem ersten Commit

- `git status` zeigt nichts aus `privat/`.
- In `daten/` stehen nur die verschlüsselten Dateien. Darin dürfen keine Ortsnamen und keine Zeiten aus dem Plan im Klartext stehen, nur `v`, `iv` und `daten`.
- Weder im Code noch in `config.json` steht das Passwort.
- `config.json` mit dem Salt darf mit ins Repository. Die verschlüsselten Dateien auch. `privat/` nicht.
