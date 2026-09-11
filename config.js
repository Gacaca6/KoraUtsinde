/* ── Kora Utware — settings you own ────────────────────────────────
 *
 *  EDIT THE FOUR MARKED LINES BELOW, then redeploy. Nothing else in the
 *  app needs changing to start taking payments.
 * ─────────────────────────────────────────────────────────────────── */

window.KORA = {

  /* ---- money ---------------------------------------------------- */

  price: 1000,
  currency: 'RWF',

  /* ← EDIT: the MTN MoMo number people send the 1,000 RWF to. */
  momoNumber: '078 000 0000',

  /* ← EDIT: the name that shows on their MoMo confirmation, so buyers
     can check they are paying the right person. */
  momoName: 'KORA UTWARE',

  /* ← EDIT: your WhatsApp number in international form, digits only,
     no + and no spaces. Rwanda numbers start 250.
     Set to '' to hide the WhatsApp button. */
  whatsapp: '250780000000',

  /* ← EDIT: the number people can SMS instead of WhatsApp.
     Set to '' to hide the SMS button. */
  sms: '+250780000000',

  /* ---- free trial ----------------------------------------------- */

  trial: {
    exams: 1,        // full timed exams before the wall
    practice: 15,    // practice questions before the wall
  },

};
