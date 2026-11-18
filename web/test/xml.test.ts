import assert from 'node:assert/strict'
import { test } from 'node:test'
import { XmlParseError, el, parseXml, serializeXml } from '../src/core/score/xml.ts'

test('xml: elements, attributes, text, entities and character references', () => {
  const root = parseXml(
    `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><!-- c --><a k="1 &amp; 2" q='"'><b>&lt;&#65;&#x42;&gt;</b><c/><![CDATA[<raw>]]></a>`,
  )
  assert.equal(root.name, 'a')
  assert.deepEqual(root.attrs, { k: '1 & 2', q: '"' })
  assert.equal(root.children[0]?.text, '<AB>')
  assert.equal(root.children[1]?.name, 'c')
  assert.equal(root.text, '<raw>')
})

test('xml: malformed input throws XmlParseError', () => {
  for (const bad of ['', '<a>', '<a></b>', '<a b=1/>', '<a>&nope;</a>', '<a/><b/>', 'text']) {
    assert.throws(() => parseXml(bad), XmlParseError)
  }
})

test('xml: serialise then parse gives the same tree, with escaping', () => {
  const tree = el('a', { k: 'x<y&"z"' }, [el('b', {}, 'a < b & c > d'), el('c')])
  const again = parseXml(serializeXml(tree))
  assert.deepEqual(again, tree)
})
