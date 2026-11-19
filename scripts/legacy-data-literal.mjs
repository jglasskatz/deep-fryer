/** Read a legacy portrait `data.js` as data, without running it.
 *
 * The original Santa Cruz site keeps its portraits in a JavaScript object
 * literal, and forks of it are edited by hand. A file from someone else's
 * repository must never be evaluated during a build, so it is parsed to a
 * syntax tree and accepted only when it is a single `JURISDICTIONS` literal
 * made of strings, numbers, booleans, null, arrays and plain objects.
 */
import ts from 'typescript';

const K = ts.SyntaxKind;
const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);

function literal(node) {
  switch (node.kind) {
    case K.StringLiteral:
    case K.NoSubstitutionTemplateLiteral:
      return node.text;
    case K.NumericLiteral:
      return Number(node.text);
    case K.TrueKeyword: return true;
    case K.FalseKeyword: return false;
    case K.NullKeyword: return null;
    case K.PrefixUnaryExpression:
      if (node.operator === K.MinusToken && node.operand.kind === K.NumericLiteral) return -Number(node.operand.text);
      break;
    case K.ArrayLiteralExpression:
      return node.elements.map(literal);
    case K.ObjectLiteralExpression: {
      const record = {};
      for (const property of node.properties) {
        // Getters, methods, spreads, shorthand and computed keys can all run code or read scope.
        if (property.kind !== K.PropertyAssignment || ![K.Identifier, K.StringLiteral].includes(property.name.kind)) throw new Error('Legacy data contains a non-literal property');
        const key = property.name.text;
        if (reservedKeys.has(key) || Object.hasOwn(record, key)) throw new Error(`Legacy data has a reserved or repeated key: ${key}`);
        record[key] = literal(property.initializer);
      }
      return record;
    }
  }
  throw new Error(`Legacy data contains a non-literal value: ${K[node.kind]}`);
}

export function readJurisdictions(text) {
  const file = ts.createSourceFile('data.js', text, ts.ScriptTarget.ES2020, false, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error('Legacy data does not parse');
  const [statement] = file.statements;
  // An assignment, a bare expression or an empty file has no declaration list; refuse it before reading one.
  const declarations = statement?.kind === K.VariableStatement ? statement.declarationList.declarations : [];
  const [declaration] = declarations;
  if (file.statements.length !== 1 || declarations.length !== 1
    || declaration.name.kind !== K.Identifier || declaration.name.text !== 'JURISDICTIONS'
    || declaration.initializer?.kind !== K.ObjectLiteralExpression) throw new Error('Legacy data must be a single JURISDICTIONS object literal');
  return literal(declaration.initializer);
}
