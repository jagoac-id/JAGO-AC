import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  CheckCircle,
  Clock,
  Camera,
  X,
  ChevronRight,
  ClipboardCheck,
  ChevronLeft,
  RefreshCw,
} from "lucide-react";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  addDoc,
} from "firebase/firestore";

interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  area: string;
  date: string;
  time: string;
  status: string;
  technician?: string;
}

interface ChecklistItem {
  status: "Normal" | "Bermasalah" | "Tidak Dicek";
  issue?: string;
}

interface IndoorChecklist {
  filter: ChecklistItem;
  evaporator: ChecklistItem;
  fan: ChecklistItem;
  swing: ChecklistItem;
  remote: ChecklistItem;
}

interface OutdoorChecklist {
  compressor: ChecklistItem;
  fan: ChecklistItem;
  condenser: ChecklistItem;
  gasPressure: ChecklistItem;
}

interface Technician {
  id: string;
  name: string;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
};

export default function TechnicianDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const initialChecklistItem: ChecklistItem = { status: "Tidak Dicek" };
  const [indoorChecklist, setIndoorChecklist] = useState<IndoorChecklist>({
    filter: { ...initialChecklistItem },
    evaporator: { ...initialChecklistItem },
    fan: { ...initialChecklistItem },
    swing: { ...initialChecklistItem },
    remote: { ...initialChecklistItem },
  });
  const [outdoorChecklist, setOutdoorChecklist] = useState<OutdoorChecklist>({
    compressor: { ...initialChecklistItem },
    fan: { ...initialChecklistItem },
    condenser: { ...initialChecklistItem },
    gasPressure: { ...initialChecklistItem },
  });

  const [activeIssueField, setActiveIssueField] = useState<{
    section: "indoor" | "outdoor";
    field: string;
  } | null>(null);
  const [issueTempText, setIssueTempText] = useState("");
  const [photoBefore, setPhotoBefore] = useState<string | null>(null);
  const [photoAfter, setPhotoAfter] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [techName, setTechName] = useState("");

  useEffect(() => {
    // Listen to active orders
    const q = query(
      collection(db, "orders"),
      where("status", "!=", "Selesai")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data: Order[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Order);
      });
      setOrders(data);
      setIsLoading(false);
    });

    // Listen to technicians list
    const unsubTechs = onSnapshot(collection(db, "technicians"), (snapshot) => {
      const data: Technician[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Technician);
      });
      setTechnicians(data.sort((a, b) => a.name.localeCompare(b.name)));
    });

    return () => {
      unsub();
      unsubTechs();
    };
  }, []);

  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      o.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (selectedTechnician) {
      return matchesSearch && o.technician === selectedTechnician;
    }
    return matchesSearch;
  });

  const compressImage = (file: File, maxWidth = 600, quality = 0.5): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxWidth) {
              width *= maxWidth / height;
              height = maxWidth;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          // Export as low quality JPEG
          const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedBase64);
        };
        img.onerror = (err) => reject(new Error("Gagal me-load gambar: " + err));
      };
      reader.readAsDataURL(file);
      reader.onerror = (err) => reject(new Error("Gagal membaca file: " + err));
    });
  };

  const handleImageChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "before" | "after"
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        if (type === "before") setPhotoBefore(compressed);
        else setPhotoAfter(compressed);
      } catch (err) {
        console.error("Compression failed:", err);
        // Fallback to original if compression fails
        const reader = new FileReader();
        reader.onloadend = () => {
          if (type === "before") setPhotoBefore(reader.result as string);
          else setPhotoAfter(reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedOrder) return;
    
    // Tech name is still helpful to have
    if (!techName) {
      alert("Mohon isi nama teknisi");
      return;
    }

    setIsSubmitting(true);

    try {
      console.log("Submitting report...");
      const reportData = {
        orderId: selectedOrder.id,
        customerName: selectedOrder.customerName,
        technicianName: techName,
        timestamp: new Date().toISOString(),
        indoorChecklist,
        outdoorChecklist,
        photoBefore: photoBefore || "",
        photoAfter: photoAfter || "",
        notes: notes || "",
      };

      const docRef = await addDoc(collection(db, "technicianReports"), reportData);
      console.log("Report saved with ID:", docRef.id);
      
      alert("Laporan berhasil dikirim ke Admin!");

      // Reset form
      setIsModalOpen(false);
      setSelectedOrder(null);
      
      const resetItem: ChecklistItem = { status: "Tidak Dicek" };
      setIndoorChecklist({
        filter: { ...resetItem },
        evaporator: { ...resetItem },
        fan: { ...resetItem },
        swing: { ...resetItem },
        remote: { ...resetItem },
      });
      setOutdoorChecklist({
        compressor: { ...resetItem },
        fan: { ...resetItem },
        condenser: { ...resetItem },
        gasPressure: { ...resetItem },
      });
      
      setPhotoBefore(null);
      setPhotoAfter(null);
      setNotes("");
    } catch (error) {
       console.error("Error saving report:", error);
       const errorMessage = error instanceof Error ? error.message : String(error);
       alert(`Gagal mengirim laporan (Error: ${errorMessage}). Pastikan koneksi internet stabil.`);
       handleFirestoreError(error, OperationType.WRITE, "technicianReports");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = (
    section: "indoor" | "outdoor",
    field: string,
    status: "Normal" | "Bermasalah" | "Tidak Dicek"
  ) => {
    if (status === "Bermasalah") {
      setActiveIssueField({ section, field });
      setIssueTempText("");
    } else {
      if (section === "indoor") {
        setIndoorChecklist((prev) => ({
          ...prev,
          [field]: { status, issue: "" },
        }));
      } else {
        setOutdoorChecklist((prev) => ({
          ...prev,
          [field]: { status, issue: "" },
        }));
      }
    }
  };

  const saveIssue = () => {
    if (!activeIssueField) return;
    const { section, field } = activeIssueField;
    if (section === "indoor") {
      setIndoorChecklist((prev) => ({
        ...prev,
        [field]: { status: "Bermasalah", issue: issueTempText },
      }));
    } else {
      setOutdoorChecklist((prev) => ({
        ...prev,
        [field]: { status: "Bermasalah", issue: issueTempText },
      }));
    }
    setActiveIssueField(null);
  };

  return (
    <div className="min-h-screen bg-[#F4F6F8] pb-20 font-sans">
      {/* Header */}
      <header className="bg-[#0B192C] text-white p-6 rounded-b-[2rem] shadow-lg sticky top-0 z-40">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-[#FFA800]">JAGO AC</h1>
              <p className="text-xs text-blue-200">Dashboard Teknisi Lapangan</p>
            </div>
            <div className="bg-white/10 p-2 rounded-full">
              <ClipboardCheck className="w-6 h-6 text-[#FFA800]" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Cari Nama Pelanggan / ID..."
                className="w-full bg-white/10 border border-white/20 rounded-2xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="bg-white/10 border border-white/20 rounded-2xl p-1 flex items-center">
               <select
                 className="w-full bg-transparent text-white text-sm py-2 px-3 focus:outline-none cursor-pointer"
                 value={selectedTechnician}
                 onChange={(e) => {
                   setSelectedTechnician(e.target.value);
                   setTechName(e.target.value); // Sync tech name for report
                 }}
               >
                 <option value="" className="text-gray-800">Semua Pesanan (Global)</option>
                 {technicians.map(t => (
                   <option key={t.id} value={t.name} className="text-gray-800">{t.name}</option>
                 ))}
               </select>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 mt-4">
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4" /> Daftar Pesanan Belum Selesai ({filteredOrders.length})
        </h2>

        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white p-8 rounded-3xl text-center shadow-sm border border-gray-100">
            <p className="text-gray-500 font-medium italic">Tidak ada pesanan aktif.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => {
                  setSelectedOrder(order);
                  setIsModalOpen(true);
                }}
                className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform cursor-pointer"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                      {order.id}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {order.date}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#0B192C]">{order.customerName}</h3>
                  <p className="text-xs text-gray-500 line-clamp-1 truncate">{order.address}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Checklist Modal */}
      <AnimatePresence>
        {isModalOpen && selectedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="bg-white w-full max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-[2.5rem] sm:rounded-[2.5rem] overflow-hidden flex flex-col"
            >
              <div className="p-6 bg-[#0B192C] text-white flex items-center justify-between sticky top-0 z-10">
                <div>
                  <h3 className="text-lg font-black text-[#FFA800]">Foam Pengecekan</h3>
                  <p className="text-xs text-blue-200">{selectedOrder.customerName} - {selectedOrder.id}</p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitReport} className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                
                {/* Tech Name */}
                <section>
                  <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">Nama Teknisi</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Masukkan nama Anda..."
                    className="w-full bg-[#F4F6F8] p-4 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-[#FFA800] outline-none"
                    value={techName}
                    onChange={(e) => setTechName(e.target.value)}
                  />
                </section>

                <section>
                  <h4 className="text-xs font-black text-[#0B192C] uppercase mb-4 border-b pb-2">Unit Indoor AC</h4>
                  <div className="grid grid-cols-1 gap-4">
                    {Object.entries(indoorChecklist).map(([key, value]) => {
                      const item = value as ChecklistItem;
                      return (
                        <div key={key} className="bg-gray-50 p-4 rounded-3xl border border-gray-100">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-bold capitalize text-gray-700">{key}</span>
                            <div className="flex bg-white rounded-xl p-1 border border-gray-200">
                              {[
                                { id: "Tidak Dicek", label: "N/A" },
                                { id: "Normal", label: "Normal" },
                                { id: "Bermasalah", label: "Masalah" },
                              ].map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => handleStatusChange("indoor", key, opt.id as any)}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                                    item.status === opt.id
                                      ? opt.id === "Normal"
                                        ? "bg-green-500 text-white"
                                        : opt.id === "Bermasalah"
                                        ? "bg-red-500 text-white"
                                        : "bg-gray-500 text-white"
                                      : "text-gray-400 hover:bg-gray-100"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {item.status === "Bermasalah" && item.issue && (
                            <div className="bg-red-50 p-2 rounded-xl text-[11px] text-red-700 border border-red-100 mt-2 flex justify-between items-center">
                              <span>{item.issue}</span>
                              <button 
                                type="button" 
                                onClick={() => handleStatusChange("indoor", key, "Bermasalah")}
                                className="text-red-500 underline"
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Outdoor Checklist */}
                <section>
                  <h4 className="text-xs font-black text-[#0B192C] uppercase mb-4 border-b pb-2">Unit Outdoor AC</h4>
                  <div className="grid grid-cols-1 gap-4">
                    {Object.entries(outdoorChecklist).map(([key, value]) => {
                      const item = value as ChecklistItem;
                      return (
                        <div key={key} className="bg-gray-50 p-4 rounded-3xl border border-gray-100">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-bold capitalize text-gray-700">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                            <div className="flex bg-white rounded-xl p-1 border border-gray-200">
                              {[
                                { id: "Tidak Dicek", label: "N/A" },
                                { id: "Normal", label: "Normal" },
                                { id: "Bermasalah", label: "Masalah" },
                              ].map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => handleStatusChange("outdoor", key, opt.id as any)}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                                    item.status === opt.id
                                      ? opt.id === "Normal"
                                        ? "bg-green-500 text-white"
                                        : opt.id === "Bermasalah"
                                        ? "bg-red-500 text-white"
                                        : "bg-gray-500 text-white"
                                      : "text-gray-400 hover:bg-gray-100"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {item.status === "Bermasalah" && item.issue && (
                            <div className="bg-red-50 p-2 rounded-xl text-[11px] text-red-700 border border-red-100 mt-2 flex justify-between items-center">
                              <span>{item.issue}</span>
                              <button 
                                type="button" 
                                onClick={() => handleStatusChange("outdoor", key, "Bermasalah")}
                                className="text-red-500 underline"
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Photo Upload */}
                <section className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Foto Sebelum</label>
                    <div className="aspect-square bg-gray-100 rounded-3xl border-2 border-dashed border-gray-300 relative overflow-hidden group">
                      {photoBefore ? (
                        <img src={photoBefore} className="w-full h-full object-cover" alt="Before" />
                      ) : (
                        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                          <Camera className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                          <input 
                            type="file" 
                            accept="image/*" 
                            capture="environment"
                            className="hidden" 
                            onChange={(e) => handleImageChange(e, "before")} 
                          />
                        </label>
                      )}
                      {photoBefore && (
                        <button type="button" onClick={() => setPhotoBefore(null)} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full"><X className="w-3 h-3"/></button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Foto Sesudah</label>
                    <div className="aspect-square bg-gray-100 rounded-3xl border-2 border-dashed border-gray-300 relative overflow-hidden group">
                      {photoAfter ? (
                        <img src={photoAfter} className="w-full h-full object-cover" alt="After" />
                      ) : (
                        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                          <Camera className="w-6 h-6 text-gray-400 group-hover:text-green-500 transition-colors" />
                          <input 
                            type="file" 
                            accept="image/*" 
                            capture="environment"
                            className="hidden" 
                            onChange={(e) => handleImageChange(e, "after")} 
                          />
                        </label>
                      )}
                      {photoAfter && (
                        <button type="button" onClick={() => setPhotoAfter(null)} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full"><X className="w-3 h-3"/></button>
                      )}
                    </div>
                  </div>
                </section>

                {/* Notes */}
                <section>
                  <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">Catatan Tambahan</label>
                  <textarea
                    rows={3}
                    placeholder="Misal: Pipa bocor sedikit, sudah dilas..."
                    className="w-full bg-[#F4F6F8] p-4 rounded-2xl font-medium text-sm focus:ring-2 focus:ring-[#FFA800] outline-none"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </section>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full py-5 rounded-3xl font-black text-sm transition-all shadow-xl flex items-center justify-center gap-3 ${
                      isSubmitting 
                        ? "bg-gray-400 text-white cursor-not-allowed" 
                        : "bg-[#0B192C] text-[#FFA800] hover:scale-[1.02] active:scale-95 shadow-blue-900/10"
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-6 h-6 animate-spin" /> MENGIRIM...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-6 h-6" /> SIMPAN & KIRIM LAPORAN
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Issue Modal */}
      <AnimatePresence>
        {activeIssueField && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl"
            >
              <div className="p-6 bg-red-600 text-white">
                <h3 className="text-lg font-black tracking-tight">Detail Masalah</h3>
                <p className="text-xs text-red-100 capitalize">
                  {activeIssueField.field.replace(/([A-Z])/g, ' $1').trim()} ({activeIssueField.section})
                </p>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-500">Jelaskan kondisi atau masalah yang ditemukan:</p>
                <textarea
                  rows={4}
                  autoFocus
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                  placeholder="Contoh: Filter sangat berdebu dan sobek..."
                  value={issueTempText}
                  onChange={(e) => setIssueTempText(e.target.value)}
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveIssueField(null)}
                    className="flex-1 py-3 rounded-2xl text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={saveIssue}
                    className="flex-1 py-3 rounded-2xl text-xs font-black bg-red-600 text-white shadow-lg shadow-red-200 hover:brightness-110 transition-all"
                  >
                    Simpan Masalah
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Nav Hint */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-gray-100 text-center">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
          Bagian dari Ekosistem <span className="text-[#0B192C]">JAGO AC</span>
        </p>
      </footer>
    </div>
  );
}
