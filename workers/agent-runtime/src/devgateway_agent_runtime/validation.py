from __future__ import annotations

import hashlib
from collections.abc import Mapping as AbcMapping

from .contracts import OutputSchemaContract, PrimitiveSchemaType, ValidationResult


def validate_structured_output(
    structured_output: object,
    output_schema: OutputSchemaContract,
    *,
    output_ref: str,
) -> ValidationResult:
    checked_fields: list[str] = []
    if not isinstance(structured_output, AbcMapping):
        return _failure(
            output_schema,
            output_ref,
            checked_fields=(),
            failure_code="not_object",
            failure_path="$",
            expected_type="object",
            actual_type=type(structured_output).__name__,
        )

    for field_name, expected_type in output_schema.required_field_types().items():
        checked_fields.append(field_name)
        if field_name not in structured_output:
            return _failure(
                output_schema,
                output_ref,
                checked_fields=tuple(checked_fields),
                failure_code="missing_required_field",
                failure_path=f"$.{field_name}",
                expected_type=expected_type,
                actual_type=None,
            )
        actual_value = structured_output[field_name]
        if not _matches_type(actual_value, expected_type):
            return _failure(
                output_schema,
                output_ref,
                checked_fields=tuple(checked_fields),
                failure_code="type_mismatch",
                failure_path=f"$.{field_name}",
                expected_type=expected_type,
                actual_type=_type_name(actual_value),
            )

    return ValidationResult(
        valid=True,
        output_schema_ref=output_schema.schema_ref,
        evidence_ref=_evidence_ref(output_schema.schema_ref, output_ref, "valid", ",".join(checked_fields)),
        checked_fields=tuple(checked_fields),
    )


def _failure(
    output_schema: OutputSchemaContract,
    output_ref: str,
    *,
    checked_fields: tuple[str, ...],
    failure_code: str,
    failure_path: str,
    expected_type: str,
    actual_type: str | None,
) -> ValidationResult:
    return ValidationResult(
        valid=False,
        output_schema_ref=output_schema.schema_ref,
        evidence_ref=_evidence_ref(output_schema.schema_ref, output_ref, failure_code, failure_path),
        checked_fields=checked_fields,
        failure_code=failure_code,
        failure_path=failure_path,
        expected_type=expected_type,
        actual_type=actual_type,
    )


def _matches_type(value: object, expected_type: str) -> bool:
    if expected_type == PrimitiveSchemaType.STRING.value:
        return isinstance(value, str)
    if expected_type == PrimitiveSchemaType.INTEGER.value:
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == PrimitiveSchemaType.NUMBER.value:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_type == PrimitiveSchemaType.BOOLEAN.value:
        return isinstance(value, bool)
    return False


def _type_name(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    return type(value).__name__


def _evidence_ref(schema_ref: str, output_ref: str, outcome: str, detail: str) -> str:
    digest = hashlib.sha256(f"{schema_ref}:{output_ref}:{outcome}:{detail}".encode("utf-8")).hexdigest()[:16]
    return f"fixture-ref:validation-evidence:{digest}"
