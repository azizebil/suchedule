## SUchedule

> **This is a fork** of [aburakayaz/suchedule](https://github.com/aburakayaz/suchedule) by Adnan Burak Ayaz,
> maintained by Aziz Derin Ebil and deployed at <https://azizebil.github.io/suchedule/>.
> The original project and its MIT license are unchanged; the sections below are from upstream.

This project allows Sabancı University students to create their schedule with a friendly user interface.

## Added in this fork

- **Hide conflicting courses** — a toggle that hides every section clashing with the courses already on your
  schedule. Your own course never hides itself, so you can still switch sections.
- **Course level filter** — All / UG / Grad, based on the first three digits of the course number, so special
  topic codes like `CS 48012` are classified correctly.
- **Multiple plans** — up to five independent schedules in named tabs. Add with `+`, rename by double
  clicking, close with `×`, reorder by dragging.
- **Shareable links** — the Share button copies a `#term=...&crns=...` link. Opening it offers to load that
  schedule into a new plan, so nothing you already built is overwritten.

## Build

`index.html` loads only the minified bundles, so regenerate them after editing the sources:

```bash
npm install
npm run build
```

## Motivation

This project was built with the hopes of making the course registration period easier for SU students.

## Code

This project was built using EcmaScript 2016 (ES6) and jQuery (3.3.1).

## External Libraries

[jQuery](https://github.com/jquery/jquery)

[ClipboardJS](https://github.com/zenorocha/clipboard.js)

## Fonts

The main font of the website is [Roboto](https://fonts.google.com/specimen/Roboto) and notifications are
written in Consolas.

For the icons, [Fontello](http://fontello.com/) has been used.

## Contribution

If you are a SU student and would like to contribute, please contact me. If you are not, and you would like
to create a similar schedule building website with your own data, feel free to do so.

## License

This project is licensed under the terms of the MIT license.              
                