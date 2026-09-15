import assert from "node:assert/strict";
import test from "node:test";
import { parseQmlDocument } from "../src/qml-parser.js";
import { cleanupFindings } from "../src/measures/cleanup.js";
import type { AnalysisContext } from "../src/analyzer.js";

test("factory aliases resolve local ids without marking sibling ids as used", () => {
  const document = parseQmlDocument(`Item {
    id: host
    Component {
      id: firstFactory
      Item {
        property alias message: message
        Text { id: message; text: host.objectName }
      }
    }
    Component {
      id: secondFactory
      Item {
        property alias message: message.text
        Text { id: message }
      }
    }
    Component {
      id: unusedFactory
      Item { Text { id: message } }
    }
    property var missing: message
  }`, "Main.qml");
  const messages = document.objects.filter((object) => object.idName === "message");
  const references = document.idReferences.filter((reference) => reference.name === "message");
  assert.deepEqual(references.map((reference) => reference.targetObjectId), [messages[0].objectId, messages[1].objectId, null]);
  assert.equal(document.idReferences.find((reference) => reference.name === "host")?.targetObjectId, document.root?.objectId);
  const findings = cleanupFindings({ components: [], qmlDocuments: [{ file: "Main.qml", document }] } as unknown as AnalysisContext);
  assert.deepEqual(findings.filter((finding) => finding.message.includes("'message'")).map((finding) => finding.line), [messages[2].line]);
});
