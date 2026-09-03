# Any-Location Quest Map Audit

This table records task records whose upstream `task.map` is empty but whose
required in-raid objectives now constrain the map scope. It is an audit aid,
not a claim that conflicting upstream metadata is correct.

| Task (ID) | New map scope | Assignment logic | Objective evidence / review note |
|---|---|---|---|
| Decisions, Decisions [PVP ZONE] (`66058cd19f59e625462acc90`) | Customs | Explicit objective map metadata | “Locate and obtain the compromising information on Ref”; metadata says Customs |
| The Tarkov Shooter – Part 5 (`5bc4836986f7740c0152911c`) | Streets, Customs, Shoreline, Woods | Reviewed multi-map exception | Sniper Scavs; guide confirms these four maps |
| Offensive Reconnaissance (`67a0970744893b9f3f0d9b68`) | Shoreline | Confirmed text/guide correction | Text says Health Resort bunker door on Shoreline; upstream The Labyrinth metadata was stale |
| Surprise Gift [PVP ZONE] (`67e993b1ac26bf29380a320b`) | Customs | Explicit objective map metadata | Objectives identify Customs / Ref |
| Bad Rep Evidence (`5967530a86f77462ba22226b`) | Customs | Explicit objective map metadata | Objective identifies Customs |
| Supervisor (`5ae449d986f774453a54a7e1`) | Interchange | All required plant objectives name Interchange in descriptions | Goshan, IDEA, and OLI register keys |
| Vitamins (`5b478eca86f7744642012254`) | Factory | Confirmed text/guide correction | Text says chemical container on Factory; upstream Shoreline metadata was stale |
| Supplements (`5b478ff486f7744d184ecbbf`) | Interchange* | Explicit objective map metadata | Text says chemical vial on Customs; metadata says Interchange — review needed |
| The Huntsman Path – Justice (`5d25e43786f7740a212217fa`) | Customs | Explicit objective map metadata | Reshala’s guards objective lists Customs |
| Capturing Outposts (`60e71b9bbd90872cb85440f3`) | Customs, Shoreline, Woods | All map names found in required objective description | Objective says specified Scav bases on Customs, Shoreline, or Woods |
| Long Road (`6193850f60b34236ee0483de`) | Lighthouse, Shoreline | All map names found in required objective description | Objective says along the shore/main road on Lighthouse or Shoreline |
| Make an Impression (`6396701b9113f06a7c3b2379`) | Streets of Tarkov | Explicit objective map metadata | Sniper Scavs objective lists Streets |
| Hot Wheels (`673f4e956f1b89c7bc0f56ef`) | Reserve | Explicit objective map metadata | BTR wheels objective lists Reserve |
| Hidden Layer (`67a096577e86e067eb045733`) | Shoreline | Explicit objective map metadata | Both Knossos objectives list Shoreline |
| Make Amends (`6391d912f8e5dd32bf4e3ab2`) | Lighthouse | Explicit objective map metadata | V3 flash drive and Lighthouse visit |
| Make Amends (`6391d9144b15ca31f76bc323`) | Lighthouse | Explicit objective map metadata | V3 flash drive and Lighthouse visit |

`*` indicates a metadata/text conflict that should be checked against the game
or a trusted guide before being treated as authoritative. The task remains
visible on the metadata-derived map until that review is resolved.
