/* ── Kora Utware — settings you own ────────────────────────────────
 *
 *  Everything the app needs to take payments lives here.
 * ─────────────────────────────────────────────────────────────────── */

window.KORA = {

  /* ---- money ---------------------------------------------------- */

  price: 1000,
  currency: 'RWF',

  /* The MTN MoMo number people send the 1,000 RWF to. */
  momoNumber: '0791 631 361',

  /* The name that shows on their MoMo confirmation, so buyers can check
     they are paying the right person. */
  momoName: 'GACACA Godwin',

  /* WhatsApp, international form, digits only — no + and no spaces.
     Set to '' to hide the WhatsApp button. */
  whatsapp: '250791631361',

  /* Number people can SMS instead of WhatsApp. '' hides the button. */
  sms: '+250791631361',

  /* ---- free trial ----------------------------------------------- */

  /* Deliberately enough to prove the app works, not enough to revise
     with. One real exam is the hook; practice is the study tool people
     pay for. Raising `practice` much above this makes wiping the app
     and starting over a workable substitute for buying it. */
  trial: {
    exams: 1,        // full timed exams before the wall
    practice: 5,     // practice questions before the wall
  },

};
