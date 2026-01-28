# Analogue Mission Observation Mapper (CCA)

A lightweight web-based tool for structured field observation in analogue space mission and habitat settings.

Developed within **Cambridge Cognitive Architecture (CCA)**.

---

## Overview

This app supports **time-based, spatially anchored observations** on a floorplan.  
Observers record activity-coded points during fixed intervals, annotated with role and badge number, and export the data for analysis.

The tool is designed for:
- analogue space missions
- habitat studies
- high-stakes / confined environments
- pilot studies and fieldwork

---

## Core features

- Timed observation intervals (e.g. 5 minutes) with automatic rollover  
- Click-to-record observations on a floorplan  
- Activity coding (e.g. walking, sitting, computer work, socialising)  
- Role attribution (e.g. commander, engineer, scientist)  
- Badge number per observed individual (shadowing)  
- Optional group flag and free-text notes  
- Normalised spatial coordinates (x, y in 0–1 range)  
- Automatic zone assignment based on plan geometry  
- CSV export for downstream analysis  

---

## Zones

Zones are defined directly in the code (`app/page.tsx`) as normalised rectangles.

Each observation is assigned to a zone at the moment of recording.  
If no zone matches, the observation is labelled `Unassigned`.

This approach allows:
- consistent zone classification across devices  
- easy adjustment of zone boundaries during piloting  

---

## Data export

Data are exported manually as a CSV file.  
Each row corresponds to one observation point and includes:

- timestamp (ISO)  
- observer  
- site  
- interval index and label  
- badge number  
- role  
- activity  
- group flag  
- x and y (normalised coordinates)  
- zone  
- note  

No data are stored on a server.

---

## Intended use

This tool is currently intended for:
- pilot studies  
- method development  
- internal research use within CCA  

Please avoid modifying the live version mid-study.

---

## Deployment

The app is built with Next.js and can be deployed using Vercel (free tier is sufficient).

---

## Citation

If you use or adapt this tool in academic work, please cite it as:

**APA style**

Gath-Morad, M., Wang, A., & Aguilar, L. (2026). *Analogue Mission Observation Mapper (CCA)* [Software]. Cambridge Cognitive Architecture, University of Cambridge.  
Available at: *URL to be added*

---

## Status

Early working version (pilot).



