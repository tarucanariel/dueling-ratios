/* =========================================================
   Teacher access config.

   TEACHER_EMAIL_DOMAIN gates the "Watch Games" spectator view — anyone
   who signs in with a Google account on this domain can see the list
   of ongoing online games and watch any of them read-only.

   Same posture as the PIN this replaced: it's a client-side check
   against the signed-in Google account's email, not a server-enforced
   permission (the database rules just require *some* signed-in user,
   same as before). Good enough to keep casual/curious students out of
   a classroom tool; not meant to withstand someone determined to read
   and patch the JS bundle. Requiring a real deped.gov.ph account is a
   meaningfully higher bar than a shared 4-digit PIN, though, since it
   can't be casually guessed or passed around by word of mouth.

   To change it: edit the string below, then rebuild/redeploy
   (npm run build && firebase deploy).
   ========================================================= */
export const TEACHER_EMAIL_DOMAIN = 'deped.gov.ph';

/* ADMIN_EMAIL gates the in-app Feedback viewer (My Suggestions/comments
   from players). Same client-side-check posture as TEACHER_EMAIL_DOMAIN
   above — the real enforcement lives in database.rules.json, which
   independently checks auth.token.email against this same address for
   read access to the feedback/ node. If you ever change this value,
   update BOTH places (this file AND database.rules.json), then
   rebuild/redeploy the app *and* deploy the database rules — the two
   are separate deploy steps and neither one updates the other. */
export const ADMIN_EMAIL = 'ariel.tarucan@deped.gov.ph';
