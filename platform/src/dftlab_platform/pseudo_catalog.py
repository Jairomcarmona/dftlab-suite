"""Private byte catalogue and alias assembly; QRAFT owns all scientific gates.

These operator helpers are not new HTTP resources or native contracts. Catalogue
facts come from PSML headers; neither XC compatibility nor run admission is
decided here. An assembled bundle is private and never redistributable.
"""
from dataclasses import dataclass, field
import hashlib
from pathlib import Path
import re
from xml.etree import ElementTree as ET

from .contracts import Contracts


@dataclass(frozen=True)
class CataloguePseudo:
    element: str
    z: int
    valence: float
    relativity: str
    nlcc: bool
    libxc_ids: tuple[int, ...]
    format: str
    sha256: str
    origin: str
    license: str
    data: bytes

    def metadata(self):
        return {key: value for key, value in vars(self).items() if key != 'data'}


def catalogue_psml(data, *, origin, license=None):
    """Read source facts without translating XC or inferring suitability."""
    if type(data) is not bytes or not origin:
        raise ValueError('Explicit source bytes and origin required')
    root = ET.fromstring(data)
    for node in root.iter():
        node.tag = node.tag.rsplit('}', 1)[-1]
    spec = root.find('pseudo-atom-spec')
    if spec is None:
        spec = root.find('header')
    if spec is None:
        raise ValueError('PSML_HEADER_MISSING')
    ids = tuple(int(node.attrib['id']) for node in spec.iter('functional'))
    return CataloguePseudo(spec.attrib['atomic-label'], int(spec.attrib['atomic-number']),
        float(spec.attrib['z-pseudo']), spec.attrib['relativity'],
        spec.attrib['core-corrections'].lower() in {'yes', 'true', 't'}, ids, 'psml',
        hashlib.sha256(data).hexdigest(), str(origin), license or 'undeclared', data)


def own_library(root):
    """Snapshot the operator-supplied proprietary library; no files are edited."""
    root = Path(root).resolve()
    result = []
    for family in ('lda', 'pbe'):
        directory = root/family
        for path in sorted(directory.glob('*.psml')):
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError('Unsafe library source')
            result.append(catalogue_psml(path.read_bytes(), origin=f'dftlab.pseudos/{family}/{path.name}',
                license='proprietary; private commercial use; all rights reserved; no redistribution'))
    return tuple(result)


@dataclass(frozen=True)
class PrivatePseudoBundle:
    files: tuple[tuple[str, bytes], ...]
    origins: tuple[tuple[str, str], ...]
    catalogue: tuple[CataloguePseudo, ...]
    redistributable: bool = field(default=False, init=False)


def species_bundle(species_definitions, catalogue):
    """Assemble exact alias bytes from immutable SpeciesDefinition references.

    The caller supplies authorized revisions and then passes these sources to
    QRAFT's existing preparation/staging. This helper never accepts a FAIL,
    edits a species revision or publishes files to a run directory.
    """
    contracts = Contracts()
    indexed = {}
    for entry in catalogue:
        if hashlib.sha256(entry.data).hexdigest() != entry.sha256:
            raise ValueError('HASH_MISMATCH')
        indexed[entry.sha256] = entry
    files, origins, chosen, labels = [], [], [], set()
    for document in species_definitions:
        contracts.validate('species-definition', document)
        species = document['payload']
        label = species['species_label']
        if not re.fullmatch(r'[A-Za-z0-9._-]+', label) or label.casefold() in labels:
            raise ValueError('SPECIES_FILENAME_MISMATCH')
        labels.add(label.casefold())
        pseudo = species['pseudo']
        entry = indexed.get(pseudo['artifact']['sha256'])
        if entry is None or pseudo['format'] != entry.format:
            raise ValueError('HASH_MISMATCH')
        files.append((f'{label}.{entry.format}', entry.data))
        origins.append((label, entry.sha256))
        chosen.append(entry)
    return PrivatePseudoBundle(tuple(files), tuple(origins), tuple(chosen))
