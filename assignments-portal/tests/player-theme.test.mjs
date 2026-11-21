import test from 'node:test';
import assert from 'node:assert/strict';
import {themeForExercise,applyPlayerTheme} from '../../public/player-theme.js';
test('exercise themes are stable and distribute a collection of exercise IDs across curated colours',()=>{
  const ids=Array.from({length:100},(_,i)=>`exercise-${i}`);
  assert.equal(new Set(ids.map(id=>themeForExercise(id).name)).size,4);
  for(const id of ids) assert.deepEqual(themeForExercise(id),themeForExercise(id));
});
test('the selected exercise theme exposes its complete palette to the player',()=>{
  const values={},root={dataset:{},style:{setProperty:(key,value)=>values[key]=value}};
  applyPlayerTheme(root,'3e3722e2-6ab2-40d0-9497-d04793eae2dc');
  const expected=themeForExercise('3e3722e2-6ab2-40d0-9497-d04793eae2dc');
  assert.equal(root.dataset.playerTheme,expected.name);
  assert.equal(values['--player-strip'],expected.strip);
  assert.equal(values['--player-current'],expected.current);
});
