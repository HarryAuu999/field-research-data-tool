# Earclip Force Curve Tool — Public Demo

A lightweight human-factors analysis tool for **ear-clip / open-ear headphones**.

This public demo shows how I connect **objective mechanical measurements** with **anthropometric ear-thickness data** to support wearable-product evaluation.

## What this tool is for

Ear-clip comfort is not determined by clamping force alone. The same product can feel very different across users because ear thickness varies, and force changes as the clip opens.

This tool therefore combines:

- Ear-thickness distribution and percentile references (P20 / P50 / P80)
- Thin / Mid / Thick ear population zones
- Force–opening-distance curves
- Repeated measurement averaging
- Contact-area / pressure analysis support
- Product-to-product curve comparison

The goal is to help translate subjective questions such as **“Does this ear clip feel too tight?”** into a more structured relationship between:

> **Anthropometrics × Mechanical load × Subjective wearing experience**

## Public demo data

For portfolio demonstration, this version contains only two publicly available commercial products:

- HUAWEI FreeClip 2
- Shokz OpenDots 2

Other internal project curves and product data have been removed.

The embedded ear-thickness population statistics are retained because they are required to demonstrate the Thin / Mid / Thick user-group analysis workflow.

## How to use

Open the online demo and view the two product curves against the ear-thickness population zones.

The tool can also:

- Show / hide measurement points
- Compare force curves
- Switch between force and pressure views when contact-area data is available
- Move curves temporarily for design exploration
- Import / export compatible project JSON files

## Research context

This tool is part of a broader effort to digitize and standardize hardware human-factors research workflows.

Related tool:

**AuNote** — a local-first PWA for structured field-research data collection, questionnaire import, participant records, anthropometric analysis and CSV / JSON export.

## Privacy

This repository is a **sanitized portfolio demo**. It does not contain confidential client projects, unreleased product data, or identifiable participant information.

---

Designed and built by Harry for consumer-electronics human-factors research.
