const prisma = require("../../config/db");

// ===========================
// Add Department
// ===========================
exports.addDepartment = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Department name is required" });
        }

        const department = await prisma.department.create({
            data: {
                name: name.toLowerCase(),
                description
            }
        });

        res.status(201).json({
            message: "Department created successfully",
            department
        });
    } catch (err) {
        console.error("Add department error:", err);
        if (err.code === "P2002") {
            return res.status(400).json({ error: "Department name must be unique" });
        }
        res.status(500).json({ error: "Failed to create department" });
    }
};

// ===========================
// Update Department
// ===========================
exports.updateDepartment = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        if (!id) {
            return res.status(400).json({ error: "Department ID is required" });
        }

        const department = await prisma.department.findUnique({
            where: { id: parseInt(id) },
        });

        if (!department) {
            return res.status(404).json({ error: "Department not found" });
        }

        // 🔒 Check if the new name already exists (and belongs to a different department)
        if (name) {
            const existing = await prisma.department.findUnique({
                where: { name: name.toLowerCase() },
            });

            if (existing && existing.id !== department.id) {
                return res
                    .status(400)
                    .json({ error: "A department with this name already exists" });
            }
        }

        const updatedDepartment = await prisma.department.update({
            where: { id: parseInt(id) },
            data: {
                ...(name && { name: name.toLowerCase() }),
                ...(description && { description }),
            },
        });

        res.status(200).json({
            message: "Department updated successfully",
            department: updatedDepartment,
        });
    } catch (err) {
        console.error("Update department error:", err);
        res.status(500).json({ error: "Failed to update department" });
    }
};

// ===========================
// Delete Department
// ===========================
exports.deleteDepartment = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: "Department ID is required" });
        }

        const department = await prisma.department.findUnique({
            where: { id: parseInt(id) },
        });

        if (!department) {
            return res.status(404).json({ error: "Department not found" });
        }

        await prisma.department.delete({
            where: { id: parseInt(id) },
        });

        res.status(200).json({ message: "Department deleted successfully" });
    } catch (err) {
        console.error("Delete department error:", err);
        res.status(500).json({ error: "Failed to delete department" });
    }
};

// ===========================
// Get All Users
// ===========================
exports.getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                createdAt: true,
                status: true,
                patient: { select: { phone: true } },
                doctor: { select: { phone: true } }
            },
            orderBy: { createdAt: "desc" }
        });

        const result = users.map(u => ({
            id: u.id,
            name: u.fullName,
            email: u.email,
            role: u.role,
            joined: u.createdAt,
            phoneNumber: u.patient?.phone || u.doctor?.phone || null,
            status: u.status
        }));

        res.json(result);
    } catch (err) {
        console.error("Get users error:", err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
};
// ===========================
// Ban / Unban User
// ===========================
exports.toggleBanUser = async (req, res) => {
    try {
        const { email } = req.body;
        const adminId = req.user.id; // from middleware verifyToken

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // find user by email
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // prevent banning yourself (admin credentials)
        if (user.id === adminId) {
            return res.status(403).json({ error: "You cannot ban/unban your own account" });
        }

        // toggle status
        const newStatus = user.status === "ACTIVE" ? "BANNED" : "ACTIVE";

        const updatedUser = await prisma.user.update({
            where: { email },
            data: { status: newStatus },
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                status: true,
                createdAt: true
            }
        });

        res.json({
            message: `User ${newStatus === "BANNED" ? "banned" : "unbanned"} successfully`,
            user: updatedUser
        });
    } catch (err) {
        console.error("Toggle ban user error:", err);
        res.status(500).json({ error: "Failed to update user status" });
    }
};

exports.getDoctorUpdateRequests = async (req, res) => {
    try {
        const requests = await prisma.doctorUpdateRequest.findMany({
            include: {
                doctor: {
                    include: {
                        user: { select: { id: true, fullName: true, email: true } }
                    }
                },
                reviewer: { select: { id: true, fullName: true, email: true } }
            },
            orderBy: { createdAt: "desc" }
        });

        res.json(requests);
    } catch (err) {
        console.error("Get doctor update requests error:", err);
        res.status(500).json({ error: "Failed to fetch doctor update requests" });
    }
};

exports.acceptRequest = async (req, res) => {
    try {
        const { requestId } = req.params;

        // get request with payload + doctor info
        const request = await prisma.doctorUpdateRequest.findUnique({
            where: { id: parseInt(requestId) },
            include: { doctor: true }
        });

        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }

        const doctorId = request.doctorId;
        const payload = request.payload || {};

        const updates = {};

        // === map simple service fields ===
        if (payload.service) {
            Object.assign(updates, {
                bio: payload.service.bio,
                title: payload.service.title,
                yearsOfExperience: payload.service.yearsOfExperience,
                licenseNumber: payload.service.licenseNumber,
                phone: payload.service.phone,
                videoProvider: payload.service.videoProvider,
                cancellationPolicy: payload.service.cancellationPolicy,
                noShowPolicy: payload.service.noShowPolicy,
                reschedulePolicy: payload.service.reschedulePolicy,
            });
        }

        if (payload.department) {
            updates.department = {
                connect: { name: payload.department }
            };
        }

        if (payload.avatar) {
            updates.avatarUrl = payload.avatar.avatarUrl;
        }

        if (payload.language) {
            updates.languages = { set: payload.language.languages || [] };
            updates.hospitals = { set: payload.language.hospitals || [] };
            updates.education = { set: payload.language.education || [] };
            updates.certificates = { set: payload.language.certificates || [] };
        }

        if (payload.availability) {
            updates.availability = {
                upsert: {
                    create: {
                        chat: payload.availability.chat,
                        video: payload.availability.video,
                        voice: payload.availability.voice,
                    },
                    update: {
                        chat: payload.availability.chat,
                        video: payload.availability.video,
                        voice: payload.availability.voice,
                    }
                }
            };
        }


        // First update doctor scalar/array fields
        await prisma.doctor.update({
            where: { id: doctorId },
            data: {
                ...updates,
                status: request.doctor.status === "PENDING" ? "ACCEPTED" : request.doctor.status,
            }
        });

        // Handle pricing separately (if it's a relation model)
        if (payload.pricing) {
            await prisma.chatVoiceVideoPricing.deleteMany({
                where: { doctorId }
            });

            await prisma.chatVoiceVideoPricing.createMany({
                data: payload.pricing.map(p => ({
                    doctorId,
                    service: p.service,
                    price: p.price,
                    currency: p.currency
                }))
            });
        }
        // mark request as approved
        const updatedRequest = await prisma.doctorUpdateRequest.update({
            where: { id: parseInt(requestId) },
            data: { status: "APPROVED" },
        });
        res.json({ message: "Doctor request accepted and profile updated", updatedRequest });
    } catch (err) {
        console.error("Accept request error:", err);
        res.status(500).json({ error: "Failed to accept doctor request" });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { note } = req.body || {};

        if (!note) {
            return res.status(400).json({ error: "Rejection note is required" });
        }

        // Reject doctor request
        const updatedRequest = await prisma.DoctorUpdateRequest.update({
            where: { id: parseInt(requestId) },
            data: { status: "REJECTED", note },
        });

        const doctor = await prisma.doctor.findUniqueOrThrow({
            where: { id: updatedRequest.doctorId }
        });

        if (doctor.status === "PENDING") {
            await prisma.doctor.update({
                where: { id: updatedRequest.doctorId },
                data: {
                    status: "REJECTED",
                    rejectionReason: note,
                },
            });
        }

        res.json({ message: "Doctor request rejected", updatedRequest });
    } catch (err) {
        console.error("Reject request error:", err);
        res.status(500).json({ error: "Failed to reject doctor request" });
    }
};

exports.deleteRequest = async (req, res) => {
    try {
        const { requestId } = req.params;

        const request = await prisma.doctorUpdateRequest.findUnique({
            where: { id: parseInt(requestId) }
        });

        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }

        if (request.status === "PENDING") {
            return res.status(400).json({ error: "Cannot delete a pending request" });
        }

        await prisma.doctorUpdateRequest.delete({
            where: { id: parseInt(requestId) }
        });

        res.json({ message: "Doctor update request deleted successfully" });
    } catch (err) {
        console.error("Delete request error:", err);
        res.status(500).json({ error: "Failed to delete doctor request" });
    }
};

// =========================
// Get Doctor Profile by ID (Admin)
// =========================
exports.getDoctorProfileById = async (req, res) => {
    try {
        const { doctorId } = req.params;

        // Validate the provided doctorId
        if (!doctorId) return res.status(400).json({ error: "Doctor ID is required" });

        // Fetch the doctor by ID including all related data
        const doctor = await prisma.doctor.findUnique({
            where: { id: Number(doctorId) },
            include: {
                user: {
                    select: {
                        fullName: true,
                        email: true,
                        status: true,
                    },
                },
                department: true,
                availability: true,
                pricing: true,
                doctorUpdateRequests: true,
                Payment: true,
                Consultation: true,
                DoctorSlot: true,
            },
        });

        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Flatten out user info
        const doctorData = {
            ...doctor,
            fullName: doctor.user?.fullName || null,
            email: doctor.user?.email || null,
            status: doctor.user?.status || null,
        };
        delete doctorData.user; // remove nested user object to keep response clean

        res.json({ doctor: doctorData });

    } catch (err) {
        console.error("❌ Error fetching doctor profile by ID:", err);
        res.status(500).json({ error: "Server error" });
    }
};
