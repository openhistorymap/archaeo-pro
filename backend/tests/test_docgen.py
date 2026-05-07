"""Smoke test for the stateless docgen — renders a minimal payload, verifies output."""
from app.payloads import (
    FindingPayload,
    PhotoPayload,
    StratigraphicUnitPayload,
    SurveillancePayload,
)
from app.services.docgen import render_docx


def test_render_docx_minimal():
    payload = SurveillancePayload(
        id="test-001",
        title="Sorveglianza di prova",
        protocollo="2026/0001",
        comune="Bologna",
        provincia="BO",
        premessa="Test premessa.",
        metodologia="Test metodologia.",
        risultati="Test risultati.",
        conclusioni="Test conclusioni.",
        findings=[
            FindingPayload(
                id="f-001",
                name="Frammento ceramico",
                description="Sigillata di età romana.",
                start_date="-0050",
                end_date="0200",
                tags={"period": "roman"},
                units=[
                    StratigraphicUnitPayload(
                        number=1,
                        type="positiva",
                        definition="strato di crollo",
                    )
                ],
            )
        ],
        photos=[],
    )
    path = render_docx(payload, photos={})
    assert path.is_file()
    assert path.suffix == ".docx"
    assert path.stat().st_size > 5_000


def test_render_docx_with_missing_photo_bytes_does_not_crash():
    payload = SurveillancePayload(
        id="test-002",
        title="Sorveglianza con foto mancante",
        photos=[PhotoPayload(id="p-001", filename="missing.jpg", caption="ignota")],
    )
    path = render_docx(payload, photos={})
    assert path.is_file()
