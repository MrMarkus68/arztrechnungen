# Arztrechnungen – DeBeKa & Beihilfe

Lokale App zum Erfassen und Nachverfolgen privater Arztrechnungen.

## Starten
Doppelklick auf **`App starten.bat`** → der Browser öffnet `http://localhost:8765`.
Das schwarze Fenster während der Nutzung offen lassen (schließen = App beenden).

## Funktionen
- **Rechnung scannen**: Foto, Kamera (am Handy/Tablet) oder PDF; mehrere Seiten möglich.
- **Automatisches Auslesen** (deutsche Texterkennung): Betrag, Rechnungsdatum, Fälligkeit,
  Behandlungsdatum, Diagnose/Behandlungsgrund, Arzt/Rechnungssteller, Rechnungsnummer.
  Erkannte Werte immer kurz prüfen – Hinweise zeigen an, was nicht gefunden wurde.
- **Aufteilung**: DeBeKa-Anteil in % (Standard unter *Mehr → Einstellungen*, pro Rechnung änderbar),
  Rest = Beihilfe.
- **Häkchen** (mit Datum): an DeBeKa geschickt, an Beihilfe geschickt, Erstattung DeBeKa,
  Erstattung Beihilfe, überwiesen.
- **Farben**: rot = offener Punkt bzw. Zahlung überfällig, orange = offene Punkte / bald fällig, grün = erledigt.
- **Suche** über alle Felder inkl. Volltext der Rechnung; **Filter** nach Jahr, Monat, Rechnungssteller, Status.
- **Export** als CSV (Excel) und **Datensicherung** (inkl. Scans) als JSON-Datei.

## Wichtig zu den Daten
Alle Daten bleiben **nur auf diesem PC im Browser** gespeichert (nichts wird hochgeladen).
Für die Texterkennung wird beim ersten Mal eine Internetverbindung benötigt (Sprachdaten).
Bitte regelmäßig *Mehr → Datensicherung speichern* nutzen – beim Löschen der Browserdaten
wären die Rechnungen sonst weg.
