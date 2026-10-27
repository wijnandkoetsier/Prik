# prik.

**Snel in je agenda.** Typ of spreek je afspraak in gewone taal, Prik maakt er een agenda-item van.

> Geprikt. En weer door.

## Wat het kan

- **Gewone taal, live voorbeeld** – terwijl je typt zie je meteen hoe Prik het begrijpt (datum, tijd, locatie, herhaling).
  - `lunch 20 oktober om 20u`, `tandarts morgen half 3`, `padel vrijdag 19u`
  - `meeting van 14 tot 16u`, `workshop morgen 10u duurt 2 uur`, `koffie over 2 uur`
  - `film vanavond`, `donderdagavond pubquiz`, `volgende week woensdag sporten`
  - `lunch donderdag 12:30 @ De Kas`, `training vrijdag 20u in Utrecht`
  - `standup elke werkdag 9:00`, `yoga elke maandag 19u`, `container om de week donderdag`
  - Slim: `etentje half 8` wordt 19:30, `om 3 uur` wordt 15:00.
- **Inspreken** met de microfoonknop (Nederlands). Staat er tekst, dan wordt de knop een verstuurknop.
- **Direct naar Google Agenda**: na het prikken opent Google Agenda met de afspraak ingevuld, jij tikt op Opslaan.
- Prik onthoudt alleen de afspraken en taken die je in Prik zelf invoert.
- **Mijn afspraken** gegroepeerd per dag (Vandaag, Morgen, …), herhalende afspraken tonen de eerstvolgende keer.
- **Maandagenda** met stipjes voor afspraken en taken, vegen om van maand te wisselen, tik een dag voor details.
- **Taken** met deadline, prioriteit (`!` of `belangrijk`), afvinken, verlopen taken in rood, herhalende taken.
- Bewerken, verwijderen met **ongedaan maken**, herinneringen in je agenda, back-up en terugzetten.
- **Installeerbaar** (PWA) en werkt **offline**. Alles blijft op je toestel.

## Starten

Geen build nodig, gewoon statische bestanden:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

De app staat online via GitHub Pages (branch `gh-pages`): https://wijnandkoetsier.github.io/Prik/

Op je telefoon: open de link in Chrome → menu (⋮) → **Toevoegen aan startscherm** / **App installeren**. Op iPhone: Safari → Deel → **Zet op beginscherm**.

## Tests

```bash
node --test
```

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De pagina |
| `css/styles.css` | Stijl (navy + lime) |
| `js/parser.js` | Nederlandse tekst → afspraak/taak |
| `js/calendar.js` | Google/Outlook-links, `.ics`, herhalingen |
| `js/app.js` | Interface, opslag, spraak |
| `sw.js`, `manifest.webmanifest`, `icons/` | App-installatie en offline |
