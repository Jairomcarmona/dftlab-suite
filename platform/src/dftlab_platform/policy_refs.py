"""R1 lossless ID projection and digest of wheel-delivered policy JSON."""
import re
from .contracts import digest


def versioned_id(literal):
    match = re.fullmatch(r'([a-z][a-z0-9_.-]*)@(0|[1-9][0-9]*)', literal)
    if match is None:
        raise ValueError('Explicit native ID@N required')
    return {'id':match[1], 'version':match[2]+'.0.0'}


def native_id(reference):
    match = re.fullmatch(r'(0|[1-9][0-9]*)\.0\.0', reference['version'])
    if match is None:
        raise ValueError('Only the approved ID@N projection can be reversed')
    literal = reference['id']+'@'+match[1]
    if versioned_id(literal) != reference:
        raise ValueError('Invalid native projection')
    return literal


def policy_reference(qraft_api, literal, *, rule_document=None):
    reference = versioned_id(literal)
    if rule_document is None:
        document = qraft_api.scientific_policy_document(literal)
    else:
        document = qraft_api.scientific_policy_document(literal, rule_document=rule_document)
    # The document is delivered by the pinned wheel; no fallback from the fiche,
    # caller defaults, Python constants or the shape of a CLI diagnostic.
    return {'policy_id':reference['id'], 'version':reference['version'], 'digest':digest(document)}, document
