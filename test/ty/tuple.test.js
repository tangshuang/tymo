import { Tuple } from '../../src/ty/index.js'

describe('Tuple', () => {
  describe('assert', () => {
    test('basic', () => {
      const TupleType = new Tuple([String, Number])
      expect(() => { TupleType.assert(['name', 10]) }).not.toThrowError()
      expect(() => { TupleType.assert(['name', null]) }).toThrowError()
    })
  })
  describe('test', () => {
    test('basic', () => {
      const TupleType = new Tuple([String, Number])
      expect(TupleType.test(['name', 10])).toBeTruthy()
      expect(TupleType.test(['name', null])).toBeFalsy()
    })
  })
  describe('catch', () => {
    test('basic', () => {
      const TupleType = new Tuple([String, Number])
      expect(TupleType.catch(['name', 10])).toBeNull()
      expect(TupleType.catch(['name', null])).toBeInstanceOf(Error)
    })
  })
  describe('trace', () => {
    test('basic', (done) => {
      const TupleType = new Tuple([String, Number])
      TupleType.trace(null).catch((error) => {
        expect(error).toBeInstanceOf(Error)
        done()
      })
    })
  })
})
