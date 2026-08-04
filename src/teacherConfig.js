/* =========================================================
   Teacher access config.

   TEACHER_PIN gates the "Watch Games" spectator view — anyone who
   knows this PIN can see the list of ongoing online games and watch
   any of them read-only. There's no login system, so this is a
   simple shared secret rather than real authentication: good enough
   to keep casual students out, not meant to stop a determined one
   (the PIN ships inside the built JS bundle, like any client-side
   check would).

   To change it: edit the string below, then rebuild/redeploy
   (npm run build, or just push — GitHub Actions redeploys on push
   to main). Pick something short but not "0000"/"1234"-obvious if
   you want it to actually deter casual guessing.
   ========================================================= */
export const TEACHER_PIN = '7710';
