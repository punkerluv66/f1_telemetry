# Development of a Web-Based Formula 1 Telemetry Analysis and Visualization Platform

Student: Ivanov Aleksandr  
Neptun code: F8ATA1  
Supervisor: Dr. Toth Robert  
Program: CS BSc

## Abstract

Modern analytical systems are expected not only to store large volumes of data, but also to transform them into precise and actionable insights. This requirement is especially visible in motorsport, where telemetry streams describe the behavior of a vehicle with high temporal resolution and where even a minor difference in braking, throttle application, or corner exit can determine lap performance. Formula 1 telemetry therefore represents a strong case study for advanced data engineering and interactive visualization.

This thesis proposes the design and implementation of a web-based telemetry analysis platform focused on Formula 1 session data obtained from the OpenF1 API. The goal of the system is to ingest raw asynchronous telemetry samples, clean and normalize the data, align multiple driver laps to a shared distance axis, and present the resulting values through an efficient and responsive web interface. The platform concentrates on mathematically non-trivial business logic, including smoothing noisy signals, interpolation across unequal sample rates, and delta-time calculation for fine-grained comparison between drivers.

The practical outcome of the thesis is a full-stack analytical application consisting of a TypeScript/Node.js backend, a PostgreSQL database for caching and query optimization, and a React-based frontend capable of rendering large datasets without severe browser degradation. In addition to implementation, the thesis evaluates the correctness of the core mathematical models and the performance characteristics of the visualization layer, with the aim of showing that modern web technologies are suitable for demanding telemetry analysis workflows.

## 1. Introduction

### 1.1 Background

Data-intensive web applications increasingly go beyond traditional create-read-update-delete functionality. In many modern domains, the actual value of a system lies in its ability to process large data streams, derive new information from incomplete or noisy measurements, and present complex outputs in a form that supports rapid decision-making. Telemetry analysis in motorsport is a representative example of this trend because it combines large time-series datasets, spatial reasoning, mathematical transformation, and interactive visual exploration.

Formula 1 telemetry contains measurements such as speed, throttle position, brake pressure, gear selection, engine status, and car position on the track. These signals are sampled asynchronously and often originate from different data streams, which makes direct comparison difficult. Analysts rarely care only about the raw values themselves; instead, they need to compare the behavior of multiple drivers at the same physical point on the circuit, identify where time is gained or lost, and understand the driving events that caused those differences.

This creates a software engineering challenge that is both academic and practical. A useful telemetry platform must not only fetch and display data, but must also implement reliable mathematical transformations, provide a robust storage layer, and maintain high rendering performance even when tens of thousands of points are shown simultaneously.

### 1.2 Problem Statement

Raw motorsport telemetry cannot be compared accurately when datasets are sampled at different moments in time or have inconsistent spatial resolution. A driver may produce more samples in one sector than another, GPS-like coordinates may include noise, and different laps may require normalization before meaningful comparison can occur. Without additional processing, overlaying multiple laps on a time axis leads to misleading interpretations because the same timestamp does not correspond to the same point on the track.

The core problem addressed by this thesis is therefore the design of a software platform that transforms asynchronous telemetry into comparable distance-based datasets while preserving responsiveness in a browser-based interface. The challenge is not limited to data retrieval; it includes data cleaning, interpolation, delta-time generation, efficient persistence, and frontend rendering under realistic analytical workloads.

### 1.3 Aim of the Thesis

The aim of this thesis is to develop a web-based Formula 1 telemetry analysis and visualization platform that demonstrates how modern web technologies can implement mathematically advanced business logic and present large-scale telemetry data interactively and efficiently.

### 1.4 Objectives

The main objectives of the thesis are the following:

1. Analyze the structure and characteristics of motorsport telemetry data and identify the main requirements of an analytical comparison platform.
2. Design a backend ingestion pipeline that retrieves raw data from the OpenF1 API, validates and normalizes it, and stores processed outputs in PostgreSQL.
3. Implement mathematical business logic for smoothing, distance-based interpolation, and delta-time computation between selected drivers or laps.
4. Develop a responsive frontend dashboard capable of rendering synchronized charts with large numbers of data points.
5. Evaluate the correctness of the implemented mathematical functions and the performance of the user interface.

### 1.5 Scope and Limitations

The project focuses on post-session telemetry analysis rather than live race control or predictive race strategy. The application is intended as an analytical tool for comparing laps and drivers using data already exposed by a public API. It does not attempt to replicate internal team tooling, real-time radio integration, or proprietary vehicle models. The emphasis is on data ingestion, transformation, caching, visualization, and performance validation within the constraints of a bachelor thesis.

### 1.6 Thesis Structure

The thesis is expected to follow a structure similar to the one below:

1. Introduction and motivation
2. Domain background and related technical concepts
3. Requirements analysis
4. System architecture and design decisions
5. Implementation of backend, database, and frontend
6. Testing and evaluation
7. Conclusion and future work

## 2. Relevance of the Topic

The relevance of this topic stems from both its engineering complexity and its broader applicability. Many industries rely on high-frequency time-series data, including finance, healthcare, industrial monitoring, logistics, and transportation. In such domains, raw measurements are rarely ready for direct presentation. They typically require synchronization, denoising, aggregation, interpolation, or comparative analysis before they become useful for human interpretation.

A telemetry analysis platform demonstrates these challenges in a concrete and engaging form. Formula 1 provides a highly dynamic environment in which small behavioral differences translate into measurable performance outcomes. Solving this problem in a browser-based application shows that modern full-stack technologies are capable of supporting analytical workloads that were historically associated with desktop or specialist tools.

From an academic perspective, the thesis is also relevant because it extends beyond routine web development. The project includes algorithmic reasoning, data modeling, caching strategy, frontend performance engineering, and testing of mathematical correctness. As a result, it provides a strong case study of how business logic can become the central value-producing layer of a software system.

## 3. Requirements Analysis

### 3.1 Functional Requirements

The system should support the following functional requirements:

1. Fetch session, driver, lap, and telemetry data from the OpenF1 API.
2. Store raw or semi-processed data in PostgreSQL to avoid repeated external requests.
3. Normalize telemetry fields into a consistent internal format.
4. Compute cumulative distance from spatial coordinates or from available lap progression data.
5. Smooth noisy telemetry channels where appropriate.
6. Interpolate telemetry values to a common distance axis shared by selected laps.
7. Calculate delta time between laps at small track intervals.
8. Detect and highlight events such as braking zones, throttle application, and apex regions.
9. Provide a dashboard where users can select session, driver, and lap combinations.
10. Render synchronized charts for speed, throttle, brake, gear, and delta time.

### 3.2 Non-Functional Requirements

In addition to correctness, the system must satisfy a set of non-functional requirements:

1. Performance: the frontend should remain responsive while rendering large telemetry arrays.
2. Scalability: repeated queries for previously processed sessions should be served quickly from cached data.
3. Accuracy: interpolation and delta-time calculations must be mathematically consistent.
4. Maintainability: backend services and frontend components should use clear TypeScript models and modular structure.
5. Usability: the interface should support fast comparative analysis without excessive user interaction overhead.
6. Reliability: ingestion failures, missing data points, and malformed API responses should be handled gracefully.

### 3.3 Domain-Specific Data Challenges

Telemetry analysis introduces a number of specific technical difficulties. First, samples from different drivers are not aligned by timestamp or by distance, which means a direct point-by-point comparison is invalid. Second, positional data may contain irregularities that affect cumulative distance estimation. Third, heavy charting workloads can create significant browser overhead if every raw point is rendered without optimization. Finally, not all derived metrics can be computed on demand for every user interaction without causing unacceptable latency.

These issues justify the architectural decision to preprocess and cache expensive computations on the backend while delivering frontend-oriented datasets that are ready for visualization.

## 4. Proposed System Architecture

### 4.1 High-Level Overview

The proposed platform follows a three-layer architecture:

1. Data ingestion and processing layer
2. Persistence and caching layer
3. Presentation and interaction layer

The backend is responsible for communicating with the external API, validating and transforming raw telemetry, and exposing REST endpoints for the frontend. PostgreSQL acts as both the primary storage layer and the cache for processed datasets. The frontend requests precomputed or semi-processed telemetry views and renders them in interactive synchronized charts.

### 4.2 Backend Layer

The backend should be implemented with Node.js and TypeScript. This combination provides a mature ecosystem, strong type safety, and a good balance between development speed and maintainability. The main backend modules should include:

1. API client module for OpenF1 communication
2. Data normalization module
3. Telemetry processing service
4. Delta-time and interpolation service
5. Session and comparison query service
6. REST controller layer

The processing service is the most important part of the backend because it contains the business logic that differentiates the project from a basic data viewer.

### 4.3 Persistence Layer

PostgreSQL is a suitable storage choice because it supports structured relations, indexing, efficient filtering, and predictable transactional behavior. A first version of the database model may include the following entities:

1. sessions
2. drivers
3. laps
4. raw_telemetry_points
5. processed_telemetry_sets
6. delta_time_sets

Raw data can be stored for traceability, while processed and interpolated results can be cached in separate tables or JSONB columns depending on the final query strategy. This design reduces repeated computation and improves dashboard response times.

### 4.4 Frontend Layer

The frontend should be implemented with React and TypeScript. The main user flow starts with selecting a session, choosing one or more drivers, and then loading a synchronized set of charts that present the chosen laps on a shared distance axis. The interface should emphasize analytical clarity and not visual decoration alone.

Important frontend responsibilities include:

1. Data loading and state coordination
2. Chart synchronization through a shared cursor or scrubber
3. Efficient rendering of large line datasets
4. Clear highlighting of sector changes, delta gain/loss, and detected track events
5. Responsive layout for different screen sizes

### 4.5 Data Flow

The expected data flow is as follows:

1. The user requests a session or driver comparison in the frontend.
2. The backend checks whether processed telemetry already exists in PostgreSQL.
3. If not, the backend fetches the raw data from OpenF1.
4. The ingestion pipeline validates and normalizes the response.
5. The processing module computes distance alignment, smoothing, and delta arrays.
6. The processed result is stored in the database.
7. The frontend receives chart-ready datasets and renders them with synchronized interactions.

This flow separates expensive mathematical computation from the rendering layer and makes repeated analysis substantially faster.

## 5. Core Business Logic

The most academically significant part of the system is the transformation of asynchronous telemetry into comparable analytical datasets. The following operations form the core of the platform:

### 5.1 Data Cleaning

The pipeline should remove duplicated records, handle missing values, validate numerical ranges, and sort points by their logical progression along the lap. If necessary, the system should discard invalid samples that would distort cumulative distance or delta calculations.

### 5.2 Smoothing

Some telemetry channels can benefit from smoothing in order to reduce visible jitter and measurement noise. The chosen smoothing method should preserve important events such as hard braking or sudden throttle application. A moving average may be sufficient for an initial version, while more advanced approaches can be considered if they preserve signal shape more reliably.

### 5.3 Distance-Based Interpolation

This is the central business logic of the thesis. Instead of comparing telemetry by timestamp, each lap should be projected onto a common distance axis. A target grid, for example every meter or every small distance interval, can be generated and used as the reference coordinate system. Each lap is then interpolated onto that grid using linear interpolation or, if justified by testing, spline-based methods.

This approach allows analysts to compare the speed, throttle, and brake traces of multiple drivers at the same physical location on the circuit, which is essential for accurate interpretation.

### 5.4 Delta-Time Calculation

Delta time estimates how much time one lap gains or loses against another across the track. Once both laps are aligned by distance, the platform can derive cumulative travel time across micro-sectors and calculate the incremental difference between the reference lap and the comparison lap. This produces a continuous delta curve that is highly valuable for identifying where performance changes occur.

### 5.5 Event Detection

Derived logic can be used to detect domain-relevant events such as the start of braking, maximum brake intensity, throttle reapplication, or approximate apex regions. These events can enrich the visualization and support more structured performance interpretation.

## 6. Testing and Evaluation Strategy

The quality of the platform should be evaluated from two perspectives: mathematical correctness and runtime performance.

### 6.1 Backend Testing

Unit tests should verify interpolation accuracy, monotonic distance progression, smoothing behavior, and delta-time consistency under controlled synthetic inputs. Integration tests should verify that the ingestion pipeline handles external API responses correctly and stores reusable outputs in the database.

### 6.2 Frontend Testing

The frontend should be tested for interaction correctness, synchronized chart behavior, and rendering stability under large input sizes. Performance profiling should focus on identifying slow re-renders, excessive memory usage, and frame drops during pointer movement or zooming.

### 6.3 Evaluation Criteria

The final evaluation of the thesis should answer the following questions:

1. Does the platform produce mathematically consistent aligned telemetry?
2. Can the user visually identify gain and loss zones clearly?
3. Is cached retrieval significantly faster than repeated raw processing?
4. Does the interface remain responsive under large telemetry loads?

## 7. Expected Contribution

The thesis is expected to contribute a practical demonstration of how advanced business logic can be implemented in a modern web stack. Its value lies not only in the final interface, but in the underlying data pipeline and mathematical transformation model. By combining data ingestion, interpolation, caching, and high-volume visualization, the project can serve as an example of applied software engineering where domain logic is the main source of complexity and innovation.

## 8. Next Writing Steps

The next stages of thesis writing should extend this draft with:

1. A related work or background chapter on telemetry analysis and time-series visualization
2. A detailed database schema chapter with diagrams
3. An implementation chapter based on the real project codebase
4. A testing chapter populated with actual benchmark and correctness results
5. A conclusion chapter summarizing outcomes, limitations, and future work
