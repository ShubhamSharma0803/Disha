# What we're building: a temporary emergency communication network that gets set up after a disaster, when phone networks are down.

The 5 major parts:

1. Deployment Planner is software. You enter the disaster area, and it tells you where to place the communication nodes.

2. Drone Deployment takes those node locations and sends drones to place them there. For the hackathon this is a simulation.

3. Adaptive Mesh Network is the core. Nodes pass emergency messages to each other hop by hop until they reach a gateway. If one node fails, the messages find another route.

4. Rescue Dashboard is a map screen for rescuers. It shows nodes, drones, incoming emergency requests, and which route each message took.

5. Passive Search Assistance is a bonus feature. It uses ESP32 Wi-Fi sniffing to estimate roughly where a nearby phone might be.

6. A sixth item, the PPT/presentation, is Palak's.

## How they connect:

Planner → Drones → Mesh Network → Dashboard

A survivor's phone connects to a node over Wi-Fi, and the message travels through the mesh to the gateway and then to the dashboard.

## Who owns what:

Shubham Sharma: Planner + Mesh Network (the core)
Sanyam: physical hardware node + drones
Sarniha: dashboard + backend
Aman: search assistance
Palak: PPT

What's real vs. simulated: there is one real hardware node. The rest of the network is software-emulated.