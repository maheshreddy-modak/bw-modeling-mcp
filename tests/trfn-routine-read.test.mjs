import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTransformationRoutines,
  extractMethodBlock,
  extractGlobalAreas,
} from '../dist/tools/transformation.js';

const XML = `
<trfn:transformation>
  <group id="0">
    <rule id="1" routinetype="END">
      <step xsi:type="trfn:StepRoutine" classNameM="/BIC/QABC_M" methodNameM="GLOBAL_END"/>
      <target><elementRef>#///target/segment1/AMOUNT</elementRef></target>
    </rule>
    <rule id="2">
      <step xsi:type="trfn:StepRoutine" classNameM="/BIC/QABC_M" methodNameM="S0001_G01_R5"/>
      <target><elementRef>#///target/segment1/BUCKET</elementRef></target>
    </rule>
    <rule id="3">
      <step xsi:type="trfn:StepDirect"/>
      <target><elementRef>#///target/segment1/BUKRS</elementRef></target>
    </rule>
  </group>
</trfn:transformation>`;

const CLASS = `class /BIC/QABC_M definition public.
private section.
**** begin of global area - insert your code only below this line     ****

  " The global area coding is only taken over (saved) if the runtime is set to ABAP

... "insert your code here

**** end of global area - insert your code only before this line       ****
ENDCLASS.

CLASS /BIC/QABC_M IMPLEMENTATION.

METHOD GLOBAL_END BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
  outTab = SELECT * FROM :inTab;
ENDMETHOD.

METHOD S0001_G01_R5.
  result = 'X'.
ENDMETHOD.
ENDCLASS.`;

test('routines are found by kind, with the class, method and target fields', () => {
  const refs = listTransformationRoutines(XML);
  assert.deepEqual(refs, [
    { kind: 'end', className: '/BIC/QABC_M', methodName: 'GLOBAL_END', targets: ['AMOUNT'] },
    { kind: 'field', className: '/BIC/QABC_M', methodName: 'S0001_G01_R5', targets: ['BUCKET'] },
  ]);
});

test('a method block is cut out whole and only that method', () => {
  const block = extractMethodBlock(CLASS, 'GLOBAL_END');
  assert.match(block, /^METHOD GLOBAL_END BY DATABASE PROCEDURE/);
  assert.match(block, /ENDMETHOD\.$/);
  assert.doesNotMatch(block, /S0001_G01_R5/);
  assert.equal(extractMethodBlock(CLASS, 'MISSING'), null);
});

test('an untouched global area is not reported, a written one is', () => {
  assert.deepEqual(extractGlobalAreas(CLASS), []);
  const written = CLASS.replace('... "insert your code here', 'DATA gt_cache TYPE SORTED TABLE OF /bic/azapfx2 WITH UNIQUE KEY rate_date.');
  const areas = extractGlobalAreas(written);
  assert.equal(areas.length, 1);
  assert.match(areas[0], /gt_cache/);
});
