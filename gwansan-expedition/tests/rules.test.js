// firestore.rules 테스트 — `npm run test:rules` (Firestore 에뮬레이터 필요, Java 11+)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';

const ADMIN = 'qjatjr7575@gmail.com';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gwansan',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const student = () => env.unauthenticatedContext().firestore();
const app = (over = {}) => ({ name: '김관산', studentId: '10203', games: ['끄투온라인', '오목'], createdAt: serverTimestamp(), ...over });

test('학생은 신청서를 만들 수 있다 (같은 부 중복 포함)', async () => {
  await assertSucceeds(setDoc(doc(student(), 'applications/10203'), app()));
  await assertSucceeds(setDoc(doc(student(), 'applications/10204'),
    app({ studentId: '10204', games: ['끄투온라인', '테트리스', '오목', '지렁이 게임'] })));
});

test('같은 학번으로 두 번 신청할 수 없다', async () => {
  await assertSucceeds(setDoc(doc(student(), 'applications/10203'), app()));
  await assertFails(setDoc(doc(student(), 'applications/10203'), app({ name: '다른사람' })));
});

test('잘못된 데이터는 거부된다', async () => {
  const db = student();
  await assertFails(setDoc(doc(db, 'applications/1020'), app({ studentId: '1020' })));            // 4자리
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ studentId: '10299' })));          // ID 불일치
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ games: [] })));                   // 종목 없음
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ games: ['롤'] })));               // 없는 종목
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ games: ['오목', '오목'] })));     // 중복 값
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ name: '' })));
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ name: 'x'.repeat(21) })));
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ createdAt: new Date(2000, 0, 1) })));
  await assertFails(setDoc(doc(db, 'applications/10203'), app({ admin: true })));                 // 추가 필드
});

test('학생은 읽기·수정·삭제를 할 수 없다', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'applications/10203'), app({ createdAt: new Date() })));
  const db = student();
  await assertFails(getDoc(doc(db, 'applications/10203')));
  await assertFails(getDocs(collection(db, 'applications')));
  await assertFails(updateDoc(doc(db, 'applications/10203'), { name: '해커' }));
  await assertFails(deleteDoc(doc(db, 'applications/10203')));
});

test('관리자만 목록을 읽을 수 있고, 관리자도 수정·삭제는 못 한다', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'applications/10203'), app({ createdAt: new Date() })));
  const admin = env.authenticatedContext('admin-uid', { email: ADMIN, email_verified: true }).firestore();
  const other = env.authenticatedContext('other-uid', { email: 'kid@example.com', email_verified: true }).firestore();
  const unverified = env.authenticatedContext('fake-uid', { email: ADMIN, email_verified: false }).firestore();
  await assertSucceeds(getDocs(collection(admin, 'applications')));
  await assertFails(getDocs(collection(other, 'applications')));
  await assertFails(getDocs(collection(unverified, 'applications')));
  await assertFails(deleteDoc(doc(admin, 'applications/10203')));
});

test('다른 컬렉션은 모두 막혀 있다', async () => {
  await assertFails(setDoc(doc(student(), 'other/x'), { a: 1 }));
});
