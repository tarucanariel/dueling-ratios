import { ref, get, update, push } from "firebase/database";
import { db } from "./firebase.js";

/* =========================================================
   Classes — a teacher can have up to MAX_CLASSES_PER_TEACHER classes,
   each with its own name, join code, and roster:
     classes/{teacherUid}/{classId}: { name, joinCode, teacherName,
                                        createdAt,
                                        students: { {studentUid}: { name, joinedAt } } }
     classJoinCodes/{code}: { teacherUid, classId, teacherName, className }
       — a reverse index so a joining student can resolve a code to a
         specific class without needing broad read access to /classes.
     playerStats/{uid}/classTeacherUid, classId, classTeacherName, className
       — classTeacherUid is what actually grants a teacher read access
         to a student's stats (see the database rule on playerStats/$uid)
         — it doesn't matter WHICH of the teacher's classes the student
         is in for that purpose, only that they're one of this
         teacher's. Joining always replaces any previous class — a
         student is only ever in at most one class, total, at a time,
         regardless of how many classes exist across the whole app.

   classId is a Firebase push() key — unique, sortable by creation
   time, and means two classes never collide even if a teacher creates
   several with the same name. ========================= */

export const MAX_CLASSES_PER_TEACHER = 5;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars — matches online.js
const CODE_LENGTH = 6;

function generateJoinCode(){
  let code = '';
  for(let i = 0; i < CODE_LENGTH; i++){
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/* Creates a new class for the signed-in teacher, as long as they're
   under the MAX_CLASSES_PER_TEACHER cap — throws 'limit-reached'
   otherwise (client-side enforced, same trust posture as the rest of
   this app's class/room features — see teacherConfig.js). */
export async function createClass(teacherUid, teacherName, className){
  const existingSnap = await get(ref(db, `classes/${teacherUid}`));
  const existingCount = existingSnap.exists() ? Object.keys(existingSnap.val()).length : 0;
  if(existingCount >= MAX_CLASSES_PER_TEACHER){
    throw new Error('limit-reached');
  }

  const classId = push(ref(db, `classes/${teacherUid}`)).key;

  let code;
  for(let attempt = 0; attempt < 5; attempt++){
    code = generateJoinCode();
    const collision = await get(ref(db, `classJoinCodes/${code}`));
    if(!collision.exists()) break; // astronomically unlikely to ever need a retry
  }

  const updates = {
    [`classes/${teacherUid}/${classId}/name`]: className,
    [`classes/${teacherUid}/${classId}/joinCode`]: code,
    [`classes/${teacherUid}/${classId}/teacherName`]: teacherName,
    [`classes/${teacherUid}/${classId}/createdAt`]: Date.now(),
    [`classJoinCodes/${code}`]: { teacherUid, classId, teacherName, className },
  };
  await update(ref(db), updates);
  return { classId, joinCode: code };
}

/* Fetches every class the signed-in teacher has created, each with its
   own roster, for the "My Classes" teacher view. Empty array if none
   yet. */
export async function getMyClasses(teacherUid){
  const snap = await get(ref(db, `classes/${teacherUid}`));
  if(!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([classId, c]) => {
    const students = c.students
      ? Object.entries(c.students).map(([uid, s]) => ({ uid, name: s.name, joinedAt: s.joinedAt }))
      : [];
    return { classId, name: c.name, joinCode: c.joinCode, teacherName: c.teacherName, createdAt: c.createdAt, students };
  }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/* Any signed-in user can look this up — needed for the join flow itself,
   before the student is a member of anything yet. */
export async function lookupJoinCode(code){
  const snap = await get(ref(db, `classJoinCodes/${code}`));
  return snap.exists() ? snap.val() : null; // { teacherUid, classId, teacherName, className } | null
}

export async function joinClass(code, studentUid, studentName){
  const lookup = await lookupJoinCode(code);
  if(!lookup) throw new Error('not-found');

  const updates = {};

  // Switching classes (rather than joining fresh) — clear the old
  // roster entry so a stale row doesn't linger in a previous class's
  // view after this student has moved on.
  const prevTeacherSnap = await get(ref(db, `playerStats/${studentUid}/classTeacherUid`));
  const prevClassIdSnap = await get(ref(db, `playerStats/${studentUid}/classId`));
  if(prevTeacherSnap.exists() && prevClassIdSnap.exists()){
    updates[`classes/${prevTeacherSnap.val()}/${prevClassIdSnap.val()}/students/${studentUid}`] = null;
  }

  updates[`classes/${lookup.teacherUid}/${lookup.classId}/students/${studentUid}`] = { name: studentName, joinedAt: Date.now() };
  updates[`playerStats/${studentUid}/classTeacherUid`] = lookup.teacherUid;
  updates[`playerStats/${studentUid}/classId`] = lookup.classId;
  updates[`playerStats/${studentUid}/classTeacherName`] = lookup.teacherName;
  updates[`playerStats/${studentUid}/className`] = lookup.className;

  await update(ref(db), updates);
  return { teacherName: lookup.teacherName, className: lookup.className };
}

export async function leaveClass(studentUid){
  const prevTeacherSnap = await get(ref(db, `playerStats/${studentUid}/classTeacherUid`));
  const prevClassIdSnap = await get(ref(db, `playerStats/${studentUid}/classId`));
  const updates = {
    [`playerStats/${studentUid}/classTeacherUid`]: null,
    [`playerStats/${studentUid}/classId`]: null,
    [`playerStats/${studentUid}/classTeacherName`]: null,
    [`playerStats/${studentUid}/className`]: null,
  };
  if(prevTeacherSnap.exists() && prevClassIdSnap.exists()){
    updates[`classes/${prevTeacherSnap.val()}/${prevClassIdSnap.val()}/students/${studentUid}`] = null;
  }
  await update(ref(db), updates);
}

/* Checks, from the STUDENT's own session, whether they're still actually
   on the roster of the class their playerStats points at — catches both
   "the whole class got deleted" and "the teacher removed just me."
   Requires the database rule granting a student read access to their own
   classes/{teacherUid}/{classId}/students/{their own uid} entry (see
   database.rules.json) — a teacher can't reach into a student's
   playerStats to clear it (see the notes on renameClass/deleteClass
   above), so this is the mechanism that makes it self-correcting: the
   student's own client notices and cleans up after itself.
   Returns true if membership is still valid, false if it just self-
   cleared a stale pointer (caller should treat the student as
   class-less and re-render accordingly). */
export async function verifyClassMembership(studentUid, classTeacherUid, classId){
  if(!classTeacherUid || !classId) return true; // nothing to verify
  const snap = await get(ref(db, `classes/${classTeacherUid}/${classId}/students/${studentUid}`));
  if(snap.exists()) return true;
  await leaveClass(studentUid);
  return false;
}

/* Renames a class the signed-in teacher owns. Updates the class record
   itself and the classJoinCodes reverse-index entry (so a code lookup
   during the join flow shows the new name right away).

   Note: does NOT touch playerStats/{studentUid}/className for students
   already in the roster — the database rules only let a student write
   their own playerStats, so a teacher-initiated rename can't reach it.
   Already-joined students will see the old name on their own "My Class"
   view until they leave and rejoin; new joins pick up the new name
   immediately via classJoinCodes. Same trust-model tradeoff as the rest
   of this file (see the top-of-file note). */
export async function renameClass(teacherUid, classId, code, newName){
  const trimmed = newName.trim();
  if(!trimmed) throw new Error('empty-name');
  const updates = {
    [`classes/${teacherUid}/${classId}/name`]: trimmed,
    [`classJoinCodes/${code}/className`]: trimmed,
  };
  await update(ref(db), updates);
  return trimmed;
}

/* Deletes a class the signed-in teacher owns — removes both the class
   record and its classJoinCodes reverse-index entry, freeing up the
   teacher's MAX_CLASSES_PER_TEACHER slot.

   Note: like renameClass, this can't reach playerStats/{studentUid} for
   any students already on the roster (database rules only let a student
   write their own playerStats) — a former student's own "My Class" view
   will keep pointing at a class that no longer exists on the teacher's
   side. Harmless (nothing reads/writes through it once the class node is
   gone) but not automatically cleaned up; the student's own "Leave Class"
   button clears it for them if it ever needs to be tidied up. */
export async function deleteClass(teacherUid, classId, code){
  const updates = {
    [`classes/${teacherUid}/${classId}`]: null,
  };
  if(code){
    updates[`classJoinCodes/${code}`] = null;
  }
  await update(ref(db), updates);
}

/* Removes a single student from a class's roster. Teacher-only — they
   already have full write access to classes/{teacherUid}/**. Same
   playerStats-pointer caveat as renameClass/deleteClass: the removed
   student's own playerStats still points at this class until their own
   client notices (via verifyClassMembership, run automatically on their
   next "My Class" view) and self-clears it. */
export async function removeStudent(teacherUid, classId, studentUid){
  await update(ref(db), {
    [`classes/${teacherUid}/${classId}/students/${studentUid}`]: null,
  });
}
