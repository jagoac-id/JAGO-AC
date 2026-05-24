import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  FileText,
  CheckCircle,
  Clock,
  RefreshCw,
  Plus,
  X,
  LogIn,
  Trash2,
  MessageCircle,
  Download,
  Printer,
  Users,
  BarChart2,
  Briefcase,
  Archive,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ShieldCheck,
  MapPin,
  Truck,
  Menu,
  ChevronDown,
  Sparkles,
  Send,
  AlertTriangle,
  Check,
  Star,
  ClipboardCheck,
} from "lucide-react";
import {
  db,
  auth,
  provider,
  handleFirestoreError,
  OperationType,
} from "../lib/firebase";
import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  updateDoc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
}

interface ExtraCost {
  description: string;
  amount: number;
  type?: "Jasa" | "Sparepart JAGO AC" | "Sparepart Luar";
}

interface Technician {
  id: string;
  name: string;
  phone: string;
  location: string;
}

interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
}

interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  area: string;
  date: string;
  time: string;
  notes: string;
  items: OrderItem[];
  subTotal: number;
  promo: { code: string; discount: number } | null;
  total: number;
  status:
    | "Menunggu Konfirmasi"
    | "Teknisi Ditugaskan"
    | "Sedang Dikerjakan"
    | "Selesai"
    | "Dibatalkan"
    | "Pending";
  createdAt: string;
  extraCosts: ExtraCost[];
  technician?: string;
  techFilterLocation?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  orderCount: number;
  totalSpent: number;
  lastServiceDate?: string;
}

interface InventoryItem {
  id: string;
  name: string;
  stock: number;
  unit: string;
  price: number;
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

interface TechnicianReport {
  id: string;
  orderId: string;
  customerName: string;
  technicianName: string;
  timestamp: string;
  indoorChecklist: IndoorChecklist;
  outdoorChecklist: OutdoorChecklist;
  photoBefore: string;
  photoAfter: string;
  notes?: string;
}

interface Promo {
  id: string;
  discount: number;
  isActive: boolean;
  maxUsageTotal: number;
  maxUsagePerDay: number;
  usedTotal: number;
  usedToday: number;
  lastUsedDate: string;
  requirement?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  minTransaction?: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
};

const safeFormatDate = (dateString: string | undefined) => {
  if (!dateString) return "-";
  const d = new Date(dateString);
  return isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

const safeFormatTime = (dateString: string | undefined) => {
  if (!dateString) return "-";
  const d = new Date(dateString);
  return isNaN(d.getTime())
    ? "-"
    : d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};

const getWhatsAppLink = (phone: string, customerName: string) => {
  if (!phone) return "#";
  let waNumber = phone.replace(/[^0-9]/g, "");
  if (waNumber.startsWith("0")) {
    waNumber = "62" + waNumber.substring(1);
  }
  const message = encodeURIComponent(
    `Halo Kak ${customerName || ""}, kami dari JAGO AC ingin mengonfirmasi pesanan jasa Anda...`,
  );
  return `https://wa.me/${waNumber}?text=${message}`;
};

const calculateFinalTotal = (order: Order) => {
  const extraTotal = (order.extraCosts || []).reduce(
    (sum, cost) => sum + (Number(cost.amount) || 0),
    0,
  );
  return (Number(order.total) || 0) + extraTotal;
};

const calculateOrderSplit = (order: Order) => {
  let baseJasa = (order.items || []).reduce(
    (sum, item) =>
      sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0,
  );
  let totalJasa = baseJasa;
  let sparepartJagoAC = 0;
  let sparepartLuar = 0;

  (order.extraCosts || []).forEach((cost) => {
    const amt = Number(cost.amount) || 0;
    if (!cost.type || cost.type === "Jasa") {
      totalJasa += amt;
    } else if (cost.type === "Sparepart JAGO AC") {
      sparepartJagoAC += amt;
    } else if (cost.type === "Sparepart Luar") {
      sparepartLuar += amt;
    }
  });

  if (order.promo) {
    totalJasa -= order.promo.discount;
    if (totalJasa < 0) totalJasa = 0;
  }

  const techCut = totalJasa * 0.7 + sparepartLuar;
  const mgmtCut = totalJasa * 0.3 + sparepartJagoAC;

  return { techCut, mgmtCut };
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state: { hasError: boolean; error: Error | null } = {
    hasError: false,
    error: null,
  };
  props: { children: React.ReactNode };
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.props = props;
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-red-600 bg-red-50 text-xl font-bold whitespace-pre-wrap">
          {this.state.error?.toString()} {"\n"} {this.state.error?.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AdminDashboardWrapper() {
  return (
    <ErrorBoundary>
      <AdminDashboard />
    </ErrorBoundary>
  );
}

const SERVICES_LIST = [
  { id: 1, name: "Jasa Cuci AC Split", defaultPrice: 75000 },
  { id: 2, name: "Isi Freon AC R22 / R32", defaultPrice: 150000 },
  { id: 3, name: "Isi Freon AC R410A", defaultPrice: 200000 },
  { id: 4, name: "Isi Full Freon R32 / R410a", defaultPrice: 300000 },
  { id: 5, name: "Isi Full Freon R22", defaultPrice: 350000 },
  { id: 6, name: "Jasa Bongkar AC", defaultPrice: 150000 },
  { id: 7, name: "Jasa Instalasi AC Split", defaultPrice: 250000 },
  { id: 8, name: "Jasa Bongkar & Pasang AC Split", defaultPrice: 350000 },
  { id: 9, name: "Las Pipa Bocor Jasa", defaultPrice: 150000 },
  { id: 10, name: "Biaya Pengecekan", defaultPrice: 50000 },
];

const INDONESIA_HOLIDAYS = [
  // 2026
  { date: "2026-01-01", name: "Tahun Baru 2026" },
  { date: "2026-02-15", name: "Isra Mi'raj Nabi Muhammad SAW" },
  { date: "2026-02-17", name: "Tahun Baru Imlek 2577" },
  { date: "2026-03-19", name: "Hari Suci Nyepi" },
  { date: "2026-03-20", name: "Idul Fitri 1447H" },
  { date: "2026-03-21", name: "Idul Fitri 1447H" },
  { date: "2026-04-03", name: "Wafat Yesus Kristus" },
  { date: "2026-05-01", name: "Hari Buruh Internasional" },
  { date: "2026-05-14", name: "Kenaikan Yesus Kristus" },
  { date: "2026-05-27", name: "Hari Raya Idul Adha 1447H" },
  { date: "2026-05-31", name: "Hari Raya Waisak" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila" },
  { date: "2026-06-16", name: "Tahun Baru Islam 1448H" },
  { date: "2026-08-17", name: "Hari Kemerdekaan RI" },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW" },
  { date: "2026-12-25", name: "Hari Raya Natal" },
  // 2027
  { date: "2027-01-01", name: "Tahun Baru 2027" },
  { date: "2027-02-03", name: "Isra Mi'raj Nabi Muhammad SAW" },
  { date: "2027-02-06", name: "Tahun Baru Imlek 2578" },
  { date: "2027-03-09", name: "Hari Suci Nyepi" },
  { date: "2027-03-10", name: "Idul Fitri 1448H" },
  { date: "2027-03-11", name: "Idul Fitri 1448H" },
  { date: "2027-03-26", name: "Wafat Yesus Kristus" },
  { date: "2027-05-01", name: "Hari Buruh Internasional" },
  { date: "2027-05-06", name: "Kenaikan Yesus Kristus" },
  { date: "2027-05-16", name: "Hari Raya Idul Adha 1448H" },
  { date: "2027-05-20", name: "Hari Raya Waisak" },
  { date: "2027-06-01", name: "Hari Lahir Pancasila" },
  { date: "2027-06-06", name: "Tahun Baru Islam 1449H" },
  { date: "2027-08-15", name: "Maulid Nabi Muhammad SAW" },
  { date: "2027-08-17", name: "Hari Kemerdekaan RI" },
  { date: "2027-12-25", name: "Hari Raya Natal" },
];

function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [techReports, setTechReports] = useState<TechnicianReport[]>([]);
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "orders"
    | "vouchers"
    | "customers"
    | "inventory"
    | "technicians"
    | "expenses"
    | "laporan"
    | "calendar"
    | "whatsapp"
    | "owner_settings"
    | "tech_reports"
    | "followup"
  >("dashboard");
  const [statsPeriod, setStatsPeriod] = useState<"7_days" | "30_days" | "this_month" | "last_month" | "custom">("30_days");
  const [statsStartDate, setStatsStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toLocaleDateString("en-CA");
  });
  const [statsEndDate, setStatsEndDate] = useState<string>(() => {
    return new Date().toLocaleDateString("en-CA");
  });
  const [voucherTabMode, setVoucherTabMode] = useState<"table" | "calendar">(
    "table",
  );
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date());
  const [reportStartDate, setReportStartDate] = useState(
    new Date().toLocaleDateString("en-CA"),
  );
  const [reportEndDate, setReportEndDate] = useState(
    new Date().toLocaleDateString("en-CA"),
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const OWNER_EMAILS = ["anjaspratama0987@gmail.com"];
  const [isAdminList, setIsAdminList] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [servicePrices, setServicePrices] = useState<Record<number, number>>(
    {},
  );
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const isOwner = OWNER_EMAILS.includes(currentUserEmail);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedReport, setSelectedReport] = useState<TechnicianReport | null>(
    null,
  );
  const [selectedWaOrder, setSelectedWaOrder] = useState<Order | null>(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // WhatsApp Helper Custom Broadcast States
  const [waHelperTab, setWaHelperTab] = useState<"pelanggan" | "database">(
    "pelanggan",
  );
  const [uploadedContacts, setUploadedContacts] = useState<
    { id: string; name: string; phone: string }[]
  >([]);
  const [blastMessage, setBlastMessage] = useState(
    "Halo {nama}, promo spesial untuk Anda hari ini!",
  );
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  const [newExtraCostDesc, setNewExtraCostDesc] = useState("");
  const [newExtraCostAmount, setNewExtraCostAmount] = useState("");
  const [newExtraCostType, setNewExtraCostType] =
    useState<ExtraCost["type"]>("Jasa");

  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(
    null,
  );
  const [invoiceOrderPreview, setInvoiceOrderPreview] = useState<Order | null>(
    null,
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [newOrder, setNewOrder] = useState<Partial<Order>>({
    status: "Pending",
    date: new Date().toLocaleDateString("en-CA"),
    time: "09:00",
    services: [],
    extraCosts: [],
    area: "",
    notes: "",
    customerName: "",
    phone: "",
    address: "",
  });

  const handleAddManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.customerName || !newOrder.phone || !newOrder.address) {
      alert("Mohon lengkapi data pelanggan");
      return;
    }

    if (!newOrder.services || newOrder.services.length === 0) {
      alert("Pilih minimal satu layanan");
      return;
    }

    try {
      const orderId =
        "WA-" + Math.random().toString(36).substr(2, 6).toUpperCase();

      const finalOrder = {
        ...newOrder,
        id: orderId,
        createdAt: new Date().toISOString(),
        totalAmount: calculateFinalTotal(newOrder as Order),
        services: newOrder.services || [],
        extraCosts: newOrder.extraCosts || [],
      } as Order;

      await setDoc(doc(db, "orders", orderId), finalOrder);
      setIsAddingOrder(false);
      setNewOrder({
        status: "Pending",
        date: new Date().toLocaleDateString("en-CA"),
        time: "09:00",
        services: [],
        extraCosts: [],
        area: "",
        notes: "",
        customerName: "",
        phone: "",
        address: "",
      });
      alert("Pesanan manual berhasil disimpan!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "orders");
    }
  };

  const tabs = [
    ...(isOwner
      ? [
          {
            id: "dashboard",
            label: "Statistik Data",
            icon: <BarChart2 className="w-4 h-4" />,
            color: "text-blue-500",
          },
        ]
      : []),
    {
      id: "calendar",
      label: "Jadwal Kalender",
      icon: <Calendar className="w-4 h-4" />,
      color: "text-purple-500",
      badge: orders.filter((o) => o.status === "Sedang Dikerjakan").length,
    },
    {
      id: "orders",
      label: "Daftar Order",
      icon: <Briefcase className="w-4 h-4" />,
      color: "text-orange-500",
      badge: orders.filter(
        (o) => o.status === "Menunggu Konfirmasi" || o.status === "Pending",
      ).length,
    },
    {
      id: "technicians",
      label: "Tim Teknisi",
      icon: <Users className="w-4 h-4" />,
      color: "text-indigo-500",
    },
    {
      id: "tech_reports",
      label: "Ceklis Teknisi",
      icon: <ClipboardCheck className="w-4 h-4" />,
      color: "text-emerald-600",
      badge: techReports.filter(r => {
        const d = new Date(r.timestamp);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length,
    },
    {
      id: "followup",
      label: "Follow-up (4 Hari)",
      icon: <MessageCircle className="w-4 h-4" />,
      color: "text-purple-600",
      badge: orders.filter(o => {
        if (o.status !== "Selesai") return false;
        const compDate = new Date(o.date);
        const diff = Math.ceil(Math.abs(new Date().getTime() - compDate.getTime()) / (1000 * 60 * 60 * 24));
        return diff >= 4 && diff <= 7;
      }).length,
    },
    {
      id: "inventory",
      label: "Stok Barang",
      icon: <Archive className="w-4 h-4" />,
      color: "text-amber-600",
    },
    ...(isOwner
      ? [
          {
            id: "expenses",
            label: "Pengeluaran",
            icon: <Archive className="w-4 h-4" />,
            color: "text-red-500",
          },
        ]
      : []),
    {
      id: "customers",
      label: "Data Pelanggan",
      icon: <Users className="w-4 h-4" />,
      color: "text-teal-500",
    },
    {
      id: "vouchers",
      label: "Atur Voucher",
      icon: <FileText className="w-4 h-4" />,
      color: "text-pink-500",
    },
    ...(isOwner
      ? [
          {
            id: "laporan",
            label: "Tutup Buku / Laporan",
            icon: <BookOpen className="w-4 h-4" />,
            color: "text-slate-500",
          },
        ]
      : []),
    {
      id: "whatsapp",
      label: "WhatsApp Helper",
      icon: <MessageCircle className="w-4 h-4" />,
      color: "text-green-500",
    },
    ...(isOwner
      ? [
          {
            id: "owner_settings",
            label: "Pengaturan Owner",
            icon: <ShieldCheck className="w-4 h-4" />,
            color: "text-slate-800",
          },
        ]
      : []),
  ] as const;

  const currentTab = tabs.find((t) => t.id === activeTab);

  const indonesianMonths = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const indonesianDays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

  const getCalendarDays = () => {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    const days = [];
    // Add empty slots for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    // Add the dates of the month
    for (let i = 1; i <= lastDate; i++) {
      days.push(i);
    }
    return days;
  };

  const ordersByDate = React.useMemo(() => {
    const map: Record<string, Order[]> = {};
    orders.forEach((o) => {
      // o.date is usually like "2026-05-10" or similar
      const d = o.date;
      if (!map[d]) map[d] = [];
      map[d].push(o);
    });
    return map;
  }, [orders]);

  const handleFileUploadContact = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const contacts: { id: string; name: string; phone: string }[] = [];

      // Basic VCF Parse
      if (file.name.toLowerCase().endsWith(".vcf")) {
        const cards = text.split(/BEGIN:VCARD/i);
        cards.forEach((card, i) => {
          if (!card.trim()) return;
          const fnMatch = card.match(/FN[^\:]*\:(.+)/i);
          const name = fnMatch ? fnMatch[1].trim() : "Unknown";

          const telRegex = /TEL[^\:]*\:(.+)/gi;
          let telMatch;
          let phone = null;
          while ((telMatch = telRegex.exec(card)) !== null) {
            phone = telMatch[1].trim();
            break;
          }
          if (phone) {
            let cleanPhone = phone.replace(/[^0-9+]/g, "");
            if (cleanPhone.startsWith("0"))
              cleanPhone = "62" + cleanPhone.substring(1);
            if (cleanPhone.startsWith("+62"))
              cleanPhone = "62" + cleanPhone.substring(3);
            contacts.push({ id: `vcf-${i}`, name, phone: cleanPhone });
          }
        });
      } else if (
        file.name.toLowerCase().endsWith(".csv") ||
        file.name.toLowerCase().endsWith(".txt")
      ) {
        // Basic CSV/TXT Parse (Name, Phone or just Phone)
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (!line.trim()) return;
          const parts = line.split(",");
          let name = `Contact ${i}`;
          let phone = parts[0];
          if (parts.length > 1) {
            name = parts[0].trim();
            phone = parts[1].trim();
          }
          let cleanPhone = phone.replace(/[^0-9+]/g, "");
          if (cleanPhone.startsWith("0"))
            cleanPhone = "62" + cleanPhone.substring(1);
          if (cleanPhone.startsWith("+62"))
            cleanPhone = "62" + cleanPhone.substring(3);
          if (cleanPhone.length > 8) {
            contacts.push({ id: `csv-${i}`, name, phone: cleanPhone });
          }
        });
      }

      if (contacts.length > 0) {
        setUploadedContacts(contacts);
        setSelectedContactIds([]);
        alert(`Berhasil memproses ${contacts.length} kontak.`);
      } else {
        alert("Tidak menemukan kontak yang valid.");
      }
    };
    reader.readAsText(file);
  };

  const getRecommendation = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      const now = new Date();
      const diffMonths =
        (now.getFullYear() - date.getFullYear()) * 12 +
        (now.getMonth() - date.getMonth());

      if (diffMonths >= 12)
        return {
          label: "FU 1Y+",
          color: "text-red-600 bg-red-100",
          icon: <AlertTriangle className="w-2.5 h-2.5" />,
        };
      if (diffMonths >= 6)
        return {
          label: "FU 6M+",
          color: "text-orange-600 bg-orange-100",
          icon: <RefreshCw className="w-2.5 h-2.5" />,
        };
      if (diffMonths >= 3)
        return {
          label: "FU 3M+",
          color: "text-blue-600 bg-blue-100",
          icon: <Clock className="w-2.5 h-2.5" />,
        };
    } catch (e) {
      return null;
    }
    return null;
  };

  const getReportWhatsAppLink = (report: TechnicianReport) => {
    // Find the order for the report to get customer phone
    const order = orders.find(o => o.id === report.orderId);
    const phone = order?.phone || "";
    if (!phone) return "#";
    
    let waNumber = phone.replace(/[^0-9]/g, "");
    if (waNumber.startsWith("0")) {
      waNumber = "62" + waNumber.substring(1);
    }

    const indoorIssues = Object.entries(report.indoorChecklist)
      .filter(([_, item]) => item.status === "Bermasalah")
      .map(([key, item]) => `- ${key.toUpperCase()}: ${item.issue || "Ada kendala"}`)
      .join("\n");

    const outdoorIssues = Object.entries(report.outdoorChecklist)
      .filter(([_, item]) => item.status === "Bermasalah")
      .map(([key, item]) => `- ${key.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}: ${item.issue || "Ada kendala"}`)
      .join("\n");

    const message = encodeURIComponent(
      `Halo Kak ${report.customerName},\n\nBerikut adalah hasil pengecekan AC Kakak oleh teknisi *${report.technicianName}*:\n\n` +
      `*STATUS UNIT INDOOR:*\n` +
      (indoorIssues || "Semua normal ✅") + "\n\n" +
      `*STATUS UNIT OUTDOOR:*\n` +
      (outdoorIssues || "Semua normal ✅") + "\n\n" +
      (report.notes ? `*Catatan:* ${report.notes}\n\n` : "") +
      `Laporan lengkap akan kami kirimkan dalam format PDF. Terima kasih! ✨\n- JAGO AC -`
    );
    
    return `https://wa.me/${waNumber}?text=${message}`;
  };

  const generateReportPdf = (report: TechnicianReport, docIn?: jsPDF) => {
    const doc = docIn || new jsPDF();
    const startY = docIn ? 20 : 0; // If it's a second page, offset or assume new page

    if (!docIn) {
      // Header for standalone report
      doc.setFillColor(11, 25, 44);
      doc.rect(0, 0, 210, 40, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("HASIL PENGECEKAN AC", 105, 18, { align: "center" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("JAGO AC - Service & Maintenance Team", 105, 26, { align: "center" });
    } else {
      doc.addPage();
      doc.setFillColor(11, 25, 44);
      doc.rect(0, 0, 210, 20, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("LAMPIRAN: HASIL PENGECEKAN AC", 105, 13, { align: "center" });
    }

    doc.setTextColor(11, 25, 44);
    doc.setFontSize(10);
    const topMargin = docIn ? 30 : 50;

    // Info Section
    doc.setFont("helvetica", "bold");
    doc.text("INFORMASI PELANGGAN", 14, topMargin);
    doc.setFont("helvetica", "normal");
    doc.text(`Nama: ${report.customerName}`, 14, topMargin + 6);
    doc.text(`ID Pesanan: ${report.orderId}`, 14, topMargin + 12);
    doc.text(`Tanggal: ${new Date(report.timestamp).toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' })}`, 14, topMargin + 18);
    
    doc.text(`Teknisi: ${report.technicianName}`, 120, topMargin + 6);
    doc.text(`Waktu: ${new Date(report.timestamp).toLocaleTimeString("id-ID")}`, 120, topMargin + 12);

    // Checklist Tables
    const indoorRows = Object.entries(report.indoorChecklist).map(([key, item]) => [
      key.replace(/([A-Z])/g, ' $1').trim().toUpperCase(),
      item.status,
      item.issue || "-"
    ]);

    const outdoorRows = Object.entries(report.outdoorChecklist).map(([key, item]) => [
      key.replace(/([A-Z])/g, ' $1').trim().toUpperCase(),
      item.status,
      item.issue || "-"
    ]);

    doc.setFont("helvetica", "bold");
    doc.text("1. UNIT INDOOR", 14, topMargin + 30);
    autoTable(doc, {
      startY: topMargin + 34,
      head: [["Komponen", "Status", "Keterangan Masalah"]],
      body: indoorRows,
      theme: "striped",
      headStyles: { fillColor: [11, 25, 44] },
      styles: { fontSize: 9 }
    });

    const nextY = (doc as any).lastAutoTable.finalY + 10;
    doc.text("2. UNIT OUTDOOR", 14, nextY);
    autoTable(doc, {
      startY: nextY + 4,
      head: [["Komponen", "Status", "Keterangan Masalah"]],
      body: outdoorRows,
      theme: "striped",
      headStyles: { fillColor: [255, 168, 0], textColor: [0, 0, 0] },
      styles: { fontSize: 9 }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFont("helvetica", "bold");
    doc.text("CATATAN TAMBAHAN:", 14, finalY);
    doc.setFont("helvetica", "normal");
    const notes = doc.splitTextToSize(report.notes || "Tidak ada catatan tambahan.", 180);
    doc.text(notes, 14, finalY + 6);

    if (!docIn) {
      doc.save(`Laporan_Ceklis_${report.orderId}_${report.customerName}.pdf`);
    }

    return doc;
  };

  const whatsappTemplates = [
    {
      id: "confirm",
      title: "Konfirmasi Pesanan",
      icon: <CheckCircle className="w-5 h-5 text-blue-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName},\n\nKami dari JAGO AC ingin mengonfirmasi pesanan jasa Anda:\n📅 Tanggal: ${order.date}\n⏰ Pukul: ${order.time}\n🏠 Alamat: ${order.address}\n\nMohon konfirmasinya ya Kak. Terima kasih!`,
    },
    {
      id: "assign",
      title: "Penugasan Teknisi",
      icon: <Users className="w-5 h-5 text-purple-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName},\n\nAdmin JAGO AC di sini. Teknisi kami atas nama *${order.technician || "..."}* telah ditugaskan untuk menangani AC Kakak hari ini sesuai jadwal (${order.time}).\n\nTerima kasih atas orderannya!`,
    },
    {
      id: "finished",
      title: "Selesai & Tagihan",
      icon: <FileText className="w-5 h-5 text-green-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName},\n\nPengerjaan AC sudah selesai kami tangani.\nTotal Biaya: *${formatCurrency(calculateFinalTotal(order))}*\n\nPembayaran bisa via transfer ke:\nBCA 7890644290\na/n ANJAS PRATAMA PUTRA\n\nTerima kasih banyak sudah menggunakan JAGO AC!`,
    },
    {
      id: "followup_3m",
      title: "FU 3",
      icon: <Clock className="w-5 h-5 text-blue-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName}, JAGO AC kembali lagi! 👋\n\nTak terasa sudah 3 bulan sejak perawatan AC terakhir Kakak. Supaya udara tetap sejuk dan mesin AC tetap awet, kami sarankan untuk melakukan pembersihan rutin kembali.\n\nMau dijadwalkan untuk kunjungan teknisi hari ini atau besok? Terima kasih! ✨`,
    },
    {
      id: "followup_6m",
      title: "FU 6",
      icon: <RefreshCw className="w-5 h-5 text-orange-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName}, sudah 6 bulan AC Kakak belum dibersihkan kembali nih... ❄️\n\nAC yang kotor biasanya mulai menumpuk debu di filter dan indoor, yang bikin AC kerja ekstra keras dan tagihan listrik naik. Jangan tunggu sampai tidak dingin ya Kak!\n\nBooking jadwal cuci sekarang yuk di JAGO AC agar kenyamanan di rumah tetap terjaga. ⚡`,
    },
    {
      id: "followup_1y",
      title: "FU 1Y",
      icon: <AlertTriangle className="w-5 h-5 text-red-500" />,
      message: (order: Order) =>
        `Halo Kak ${order.customerName}, apa kabar? Kami cukup khawatir dengan kondisi AC Kakak... 🙏\n\nSudah 1 tahun AC belum dicuci, ini sudah masuk tahap berisiko tinggi. Selain udara bisa berbau dan jadi sarang bakteri, komponen kompresor AC terancam rusak permanen atau jebol jika terus dipaksa bekerja dalam kondisi kotor.\n\nBiaya ganti kompresor jauh lebih mahal daripada biaya cuci rutin lho Kak. Segera berikan ventilasi sehat untuk keluarga tercinta dengan cuci AC hari ini. JAGO AC siap siaga membantu! 🛠️`,
    },
    {
      id: "followup_4days",
      title: "FU 4 Hari",
      icon: <MessageCircle className="w-5 h-5 text-purple-600" />,
      message: (order: Order) =>
        `Halo Kak *${order.customerName}*,\n\nKami dari *JAGO AC* ingin menanyakan kondisi AC yang kami cuci 4 hari yang lalu. Apakah sudah dingin maksimal dan tidak ada kendala? 😊\n\nKami ingatkan kembali bahwa Kakak mendapatkan *Garansi 7 Hari* pasca pengerjaan jika ada keluhan. Kami selalu berkomitmen memberikan pelayanan terbaik untuk Kakak.\n\nTerima kasih atas kepercayaannya! ✨\n- JAGO AC -`,
    }
  ];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Teks berhasil disalin!");
  };

  const handleMonthNav = (dir: number) => {
    const next = new Date(currentCalendarMonth);
    next.setMonth(next.getMonth() + dir);
    setCurrentCalendarMonth(next);
  };

  const reportMetrics = React.useMemo(() => {
    const startObj = new Date(reportStartDate);
    startObj.setHours(0, 0, 0, 0);
    const start = startObj.getTime();

    const endObj = new Date(reportEndDate);
    endObj.setHours(23, 59, 59, 999);
    const end = endObj.getTime();

    const periodOrders = orders.filter((o) => {
      const t = new Date(o.createdAt).getTime();
      return o.status === "Selesai" && t >= start && t <= end;
    });

    const periodExpenses = expenses.filter((e) => {
      const tObj = new Date(e.date);
      tObj.setHours(0, 0, 0, 0);
      const t = tObj.getTime();
      return t >= start && t <= end;
    });

    let totalRevenue = 0;
    let totalTechFee = 0;
    let totalMgmtFee = 0;

    periodOrders.forEach((o) => {
      totalRevenue += calculateFinalTotal(o);
      const split = calculateOrderSplit(o);
      totalTechFee += split.techCut;
      totalMgmtFee += split.mgmtCut;
    });

    const totalExpense = periodExpenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalMgmtFee - totalExpense;

    return {
      periodOrders,
      periodExpenses,
      totalRevenue,
      totalTechFee,
      totalMgmtFee,
      totalExpense,
      netProfit,
    };
  }, [orders, expenses, reportStartDate, reportEndDate]);

  const handleDownloadReportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text("Laporan Keuangan JAGO AC", 14, 22);
    doc.setFontSize(11);
    doc.text(
      `Periode: ${new Date(reportStartDate).toLocaleDateString("id-ID")} - ${new Date(reportEndDate).toLocaleDateString("id-ID")}`,
      14,
      30,
    );

    autoTable(doc, {
      startY: 40,
      head: [["Keterangan", "Jumlah"]],
      body: [
        [
          "Total Omset / Pendapatan Kotor",
          formatCurrency(reportMetrics.totalRevenue),
        ],
        ["Total Hak / Fee Teknisi", formatCurrency(reportMetrics.totalTechFee)],
        [
          "Total Pendapatan JAGO AC",
          formatCurrency(reportMetrics.totalMgmtFee),
        ],
        [
          "Total Pengeluaran (Admin)",
          formatCurrency(reportMetrics.totalExpense),
        ],
        ["Laba Bersih", formatCurrency(reportMetrics.netProfit)],
      ],
      theme: "grid",
      headStyles: { fillColor: [11, 25, 44] },
    });

    let currentY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.text("Rincian Pengeluaran", 14, currentY);

    if (reportMetrics.periodExpenses.length > 0) {
      const expRows = reportMetrics.periodExpenses.map((e) => [
        new Date(e.date).toLocaleDateString("id-ID"),
        e.description,
        formatCurrency(e.amount),
      ]);
      autoTable(doc, {
        startY: currentY + 5,
        head: [["Tanggal", "Keterangan", "Nominal"]],
        body: expRows,
        theme: "striped",
        headStyles: { fillColor: [239, 68, 68] },
      });
    } else {
      doc.setFontSize(10);
      doc.text("Tidak ada pengeluaran di periode ini.", 14, currentY + 7);
    }

    doc.save(
      `Laporan_Keuangan_JAGO_AC_${reportStartDate}_to_${reportEndDate}.pdf`,
    );
  };

  const handleDownloadReportExcel = () => {
    const wb = XLSX.utils.book_new();

    const summaryData = [
      ["Keterangan", "Jumlah"],
      ["Periode", `${reportStartDate} - ${reportEndDate}`],
      ["Total Omset", reportMetrics.totalRevenue],
      ["Total Fee Teknisi", reportMetrics.totalTechFee],
      ["Total Pendapatan JAGO AC", reportMetrics.totalMgmtFee],
      ["Total Pengeluaran", reportMetrics.totalExpense],
      ["Laba Bersih", reportMetrics.netProfit],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Laba Rugi");

    const expData = [["Tanggal", "Keterangan", "Nominal"]];
    reportMetrics.periodExpenses.forEach((e) => {
      expData.push([e.date, e.description, e.amount.toString()]);
    });
    const wsExp = XLSX.utils.aoa_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, wsExp, "Rincian Pengeluaran");

    const ordersData = [
      [
        "Tanggal",
        "No. Order",
        "Nama Pelanggan",
        "Teknisi",
        "Total Omset",
        "Fee Teknisi",
        "Pendapatan JAGO AC",
      ],
    ];
    reportMetrics.periodOrders.forEach((o) => {
      const split = calculateOrderSplit(o);
      ordersData.push([
        new Date(o.createdAt).toLocaleDateString("id-ID"),
        o.id,
        o.customerName,
        o.technician || "-",
        calculateFinalTotal(o).toString(),
        split.techCut.toString(),
        split.mgmtCut.toString(),
      ]);
    });
    const wsOrders = XLSX.utils.aoa_to_sheet(ordersData);
    XLSX.utils.book_append_sheet(wb, wsOrders, "Rincian Pesanan");

    XLSX.writeFile(
      wb,
      `Laporan_Keuangan_${reportStartDate}_to_${reportEndDate}.xlsx`,
    );
  };

  const handleDownloadFullSummaryExcel = () => {
    const wb = XLSX.utils.book_new();

    // 1. Orders Sheet
    const ordersData = orders.map((o) => ({
      ID: o.id,
      Pelanggan: o.customerName,
      Phone: o.phone,
      Alamat: o.address,
      Area: o.area,
      Tanggal: o.date,
      Jam: o.time,
      Status: o.status === "Pending" ? "Menunggu Konfirmasi" : o.status,
      Subtotal: o.subTotal,
      Diskon: o.promo?.discount || 0,
      Total: calculateFinalTotal(o),
      Teknisi: o.technician || "-",
      "Dibuat Pada": new Date(o.createdAt).toLocaleString("id-ID"),
    }));
    const wsOrders = XLSX.utils.json_to_sheet(ordersData);
    XLSX.utils.book_append_sheet(wb, wsOrders, "Semua Pesanan");

    // 2. Expenses Sheet
    const expensesData = expenses.map((e) => ({
      Tanggal: e.date,
      Deskripsi: e.description,
      Nominal: e.amount,
    }));
    const wsExpenses = XLSX.utils.json_to_sheet(expensesData);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Pengeluaran");

    // 3. Inventory Sheet
    const inventoryData = inventory.map((i) => ({
      Nama: i.name,
      Stok: i.stock,
      Satuan: i.unit,
      Harga: i.price,
    }));
    const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
    XLSX.utils.book_append_sheet(wb, wsInventory, "Stok Barang");

    // 4. Customer Sheet
    const customersData = parsedCustomers.map((c) => ({
      Nama: c.name,
      Phone: c.phone,
      Alamat: c.address,
      "Total Order": c.orderCount,
      "Total Belanja": c.totalSpent,
      "Terakhir Cuci": c.lastServiceDate
        ? new Date(c.lastServiceDate).toLocaleDateString("id-ID")
        : "-",
    }));
    const wsCustomers = XLSX.utils.json_to_sheet(customersData);
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Pelanggan");

    // 5. Technicians Sheet
    const technicianData = technicians.map((t) => ({
      Nama: t.name,
      Phone: t.phone,
      Lokasi: t.location,
    }));
    const wsTechnicians = XLSX.utils.json_to_sheet(technicianData);
    XLSX.utils.book_append_sheet(wb, wsTechnicians, "Teknisi");

    // 6. Promos Sheet
    const promosData = promos.map((p) => ({
      Kode: p.id,
      Diskon: p.discount,
      Aktif: p.isActive ? "Ya" : "Tidak",
      "Min Transaksi": p.minTransaction || 0,
      "Limit Total": p.maxUsageTotal,
      Terpakai: p.usedTotal,
    }));
    const wsPromos = XLSX.utils.json_to_sheet(promosData);
    XLSX.utils.book_append_sheet(wb, wsPromos, "Voucher");

    XLSX.writeFile(
      wb,
      `Laporan_Lengkap_JAGO_AC_${new Date().toLocaleDateString("en-CA")}.xlsx`,
    );
  };

  const handleDownloadFullSummaryPDF = () => {
    const doc = new jsPDF();
    const today = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    doc.setFontSize(22);
    doc.setTextColor(11, 25, 44);
    doc.text("LAPORAN RANGKUMAN MENYELURUH", 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Dicetak pada: ${today}`, 14, 28);
    doc.text(`JAGO AC - Service AC Profesional`, 14, 34);

    // --- SECTION 1: FINANCIAL SUMMARY ---
    let totalRevenue = orders
      .filter((o) => o.status === "Selesai")
      .reduce((sum, o) => sum + calculateFinalTotal(o), 0);
    let totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text("1. Ringkasan Keuangan", 14, 45);

    autoTable(doc, {
      startY: 50,
      body: [
        [
          "Total Pesanan Selesai",
          orders.filter((o) => o.status === "Selesai").length.toString(),
        ],
        ["Total Omset (Gross)", formatCurrency(totalRevenue)],
        ["Total Pengeluaran", formatCurrency(totalExpense)],
        ["Estimasi Laba Bersih", formatCurrency(totalRevenue - totalExpense)],
      ],
      theme: "grid",
      headStyles: { fillColor: [11, 25, 44] },
      styles: { cellPadding: 4 },
    });

    // --- SECTION 2: STATISTIKA ---
    let nextY = (doc as any).lastAutoTable.finalY + 15;
    doc.text("2. Statistika Operasional", 14, nextY);
    autoTable(doc, {
      startY: nextY + 5,
      body: [
        ["Jumlah Teknisi", technicians.length.toString()],
        ["Jumlah Item Inventaris", inventory.length.toString()],
        ["Total Database Pelanggan", parsedCustomers.length.toString()],
        ["Voucher Aktif", promos.filter((p) => p.isActive).length.toString()],
      ],
      theme: "grid",
    });

    // --- SECTION 3: RECENT ORDERS ---
    nextY = (doc as any).lastAutoTable.finalY + 15;
    if (nextY > 230) {
      doc.addPage();
      nextY = 20;
    }
    doc.text("3. Daftar Pesanan Terakhir (Max 30)", 14, nextY);
    const orderRows = orders.slice(0, 30).map((o) => [
      o.id,
      o.customerName,
      o.date,
      o.status === "Pending" ? "Menunggu Konfirmasi" : o.status,
      formatCurrency(calculateFinalTotal(o)),
    ]);
    autoTable(doc, {
      startY: nextY + 5,
      head: [["ID", "Pelanggan", "Tanggal", "Status", "Total"]],
      body: orderRows,
      theme: "striped",
      headStyles: { fillColor: [11, 25, 44] },
    });

    // --- SECTION 4: INVENTORY ---
    nextY = (doc as any).lastAutoTable.finalY + 15;
    if (nextY > 230) {
      doc.addPage();
      nextY = 20;
    }
    doc.text("4. Stok Barang", 14, nextY);
    const invRows = inventory.map((i) => [
      i.name,
      i.stock.toString(),
      i.unit,
      formatCurrency(i.price),
    ]);
    autoTable(doc, {
      startY: nextY + 5,
      head: [["Nama Item", "Stok", "Unit", "Harga"]],
      body: invRows,
      theme: "striped",
      headStyles: { fillColor: [11, 25, 44] },
    });

    doc.save(
      `Rangkuman_Lengkap_JAGO_AC_${new Date().toLocaleDateString("en-CA")}.pdf`,
    );
  };

  const generateInvoicePdfDoc = (order: Order) => {
    const doc = new jsPDF();

    // Modern Header Background
    doc.setFillColor(11, 25, 44); // #0B192C
    doc.rect(0, 0, 210, 45, "F");

    // Logo / Title
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.text("JAGO AC", 14, 24);

    // Subtitle
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(160, 171, 186);
    doc.text("Solusi Jasa AC Profesional & Terpercaya", 14, 32);

    // INVOICE text
    doc.setFontSize(24);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("INVOICE", 196, 24, { align: "right" });

    doc.setFontSize(10);
    doc.setTextColor(160, 171, 186);
    doc.setFont("helvetica", "normal");
    doc.text(`Kode Order: ${order.id}`, 196, 32, { align: "right" });

    // Customer & Order Info Section
    doc.setTextColor(11, 25, 44);

    // Left side: Ditagihkan Kepada
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("DITAGIHKAN KEPADA:", 14, 60);

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(order.customerName || "-", 14, 66);
    doc.text(`No. WA: ${order.phone || "-"}`, 14, 72);

    const lines = doc.splitTextToSize(
      `Alamat: ${order.address || "-"}, \nWilayah: ${order.area || "-"}`,
      85,
    );
    doc.text(lines, 14, 78);

    // Right side: Informasi Pesanan
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 25, 44);
    doc.text("INFO PESANAN:", 120, 60);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);

    const dateObj = order.createdAt ? new Date(order.createdAt) : new Date(0);
    const dateStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "-";

    doc.text(`Tanggal Masuk: ${dateStr}`, 120, 66);
    doc.text(
      `Jadwal Pelayanan: ${order.date || "-"} | ${order.time || "-"}`,
      120,
      72,
    );
    doc.text(
      `Status: ${order.status === "Pending" ? "Menunggu Konfirmasi" : order.status || "-"}`,
      120,
      78,
    );

    if (order.technician) {
      doc.text(`Teknisi: ${order.technician}`, 120, 84);
    }

    // Table
    const tableColumn = ["Nama Layanan / Item", "Harga", "Qty", "Total"];
    const tableRows: any[] = [];

    (order.items || []).forEach((item) => {
      tableRows.push([
        item.name,
        formatCurrency(item.price),
        item.quantity,
        formatCurrency(item.price * item.quantity),
      ]);
    });

    if (order.extraCosts && order.extraCosts.length > 0) {
      order.extraCosts.forEach((cost) => {
        tableRows.push([
          `Tambahan: ${cost.description}`,
          formatCurrency(cost.amount),
          "1",
          formatCurrency(cost.amount),
        ]);
      });
    }

    let finalTotal = calculateFinalTotal(order);

    autoTable(doc, {
      startY: 95,
      head: [tableColumn],
      body: tableRows,
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [11, 25, 44], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: "right" },
        2: { halign: "center" },
        3: { halign: "right" },
      },
      foot: [
        ["", "", "Subtotal", formatCurrency(order.subTotal)],
        [
          "",
          "",
          "Diskon",
          order.promo ? `-${formatCurrency(order.promo.discount)}` : "Rp 0",
        ],
        ["", "", "Total Akhir", formatCurrency(finalTotal)],
      ],
      footStyles: {
        fillColor: [244, 246, 248],
        textColor: [11, 25, 44],
        fontStyle: "bold",
        halign: "right",
      },
    });

    // Footer Notes & Payment
    const finalY = (doc as any).lastAutoTable.finalY || 150;

    // PEMBAYARAN
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 25, 44);
    doc.text("Informasi Pembayaran:", 14, finalY + 15);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text("Transfer Bank BCA", 14, finalY + 22);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 25, 44);
    doc.text("7890644290", 14, finalY + 28);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text("a/n ANJAS PRATAMA PUTRA", 14, finalY + 34);

    // CATATAN
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 25, 44);
    doc.text("Catatan:", 105, finalY + 15);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    const notesText =
      "1. Terima kasih telah menggunakan layanan JAGO AC.\n2. Invoice ini merupakan bukti pembayaran sah jika transaksi telah selesai divalidasi.\n3. Garansi layanan berlaku sesuai S&K yang berlaku.";
    const splitNotes = doc.splitTextToSize(notesText, 90);
    doc.text(splitNotes, 105, finalY + 22);

    // Thanks message
    doc.setFontSize(11);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(0, 0, 0); // #000000
    doc.text("~ Terima Kasih Atas Kepercayaan Anda! ~", 105, finalY + 55, {
      align: "center",
    });

    // Check if there is a technician report for this order
    const report = techReports.find(r => r.orderId === order.id);
    if (report) {
      generateReportPdf(report, doc);
    }

    return doc;
  };

  const handlePrintInvoice = (order: Order) => {
    const doc = generateInvoicePdfDoc(order);
    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    setInvoicePreviewUrl(pdfUrl);
    setInvoiceOrderPreview(order);
  };

  const handleDownloadInvoice = () => {
    if (invoiceOrderPreview) {
      const doc = generateInvoicePdfDoc(invoiceOrderPreview);
      doc.save(`Invoice_JagoAC_${invoiceOrderPreview.id}.pdf`);
      // Optional: revoke the url
      if (invoicePreviewUrl) {
        URL.revokeObjectURL(invoicePreviewUrl);
      }
      setInvoicePreviewUrl(null);
      setInvoiceOrderPreview(null);
    }
  };

  const handleExportOrders = (format: "csv" | "excel") => {
    const data = orders.map((order) => {
      const dateObj = order.createdAt ? new Date(order.createdAt) : new Date(0);
      const dateStr = !isNaN(dateObj.getTime())
        ? dateObj.toLocaleString("id-ID")
        : "-";
      const discount = order.promo?.discount || 0;
      return {
        "Kode Order": order.id,
        "Waktu Pemesanan": dateStr,
        "Nama Pelanggan": order.customerName,
        "No Hp": order.phone,
        Alamat: order.address,
        Wilayah: order.area,
        "Tanggal Jadwal": order.date,
        "Jam Jadwal": order.time,
        Catatan: order.notes || "",
        Status:
          order.status === "Pending" ? "Menunggu Konfirmasi" : order.status,
        Subtotal: order.subTotal,
        Diskon: discount,
        Total: order.total,
      };
    });

    if (format === "csv") {
      let csv =
        "Kode Order,Waktu Pemesanan,Nama Pelanggan,No Hp,Alamat,Wilayah,Tanggal Jadwal,Jam Jadwal,Catatan,Status,Subtotal,Diskon,Total\n";
      data.forEach((order) => {
        csv += `"${order["Kode Order"]}","${order["Waktu Pemesanan"]}","${order["Nama Pelanggan"]}","${order["No Hp"]}","${order["Alamat"]}","${order["Wilayah"]}","${order["Tanggal Jadwal"]}","${order["Jam Jadwal"]}","${order["Catatan"]}","${order["Status"]}","${order["Subtotal"]}","${order["Diskon"]}","${order["Total"]}"\n`;
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Data_Pesanan_JagoAC_${new Date().toLocaleDateString("id-ID")}.csv`;
      a.click();
    } else {
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Pesanan");
      XLSX.writeFile(
        workbook,
        `Data_Pesanan_JagoAC_${new Date().toLocaleDateString("id-ID")}.xlsx`,
      );
    }
  };

  const handleExportVouchers = (format: "csv" | "excel") => {
    const data = promos.map((p) => {
      const todayStr = new Date().toLocaleDateString("en-CA");
      const currentDayUsage =
        p.lastUsedDate === todayStr ? p.usedToday || 0 : 0;
      const statusText = p.isActive ? "Aktif" : "Nonaktif";
      return {
        "Kode Voucher": p.id,
        "Diskon(Rp)": p.discount,
        Syarat: p.requirement || "Semua",
        Status: statusText,
        "Terpakai Hari Ini": currentDayUsage,
        "Batas Harian": p.maxUsagePerDay,
        "Total Terpakai": p.usedTotal || 0,
        "Batas Total": p.maxUsageTotal,
      };
    });

    if (format === "csv") {
      let csv =
        "Kode Voucher,Diskon(Rp),Syarat,Status,Terpakai Hari Ini,Batas Harian,Total Terpakai,Batas Total\n";
      data.forEach((p) => {
        csv += `"${p["Kode Voucher"]}","${p["Diskon(Rp)"]}","${p["Syarat"]}","${p["Status"]}","${p["Terpakai Hari Ini"]}","${p["Batas Harian"]}","${p["Total Terpakai"]}","${p["Batas Total"]}"\n`;
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Data_Voucher_JagoAC_${new Date().toLocaleDateString("id-ID")}.csv`;
      a.click();
    } else {
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Voucher");
      XLSX.writeFile(
        workbook,
        `Data_Voucher_JagoAC_${new Date().toLocaleDateString("id-ID")}.xlsx`,
      );
    }
  };

  // Inventory Form Modal State
  const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
  const [editingInventory, setEditingInventory] =
    useState<InventoryItem | null>(null);
  const [inventoryForm, setInventoryForm] = useState({
    name: "",
    stock: "",
    unit: "",
    price: "",
  });

  // Promo Form Modal State
  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Promo | null>(null);
  const [promoForm, setPromoForm] = useState({
    id: "",
    discount: "",
    isActive: true,
    maxUsageTotal: "",
    maxUsagePerDay: "",
    requirement: "",
    description: "",
    startDate: "",
    endDate: "",
    minTransaction: "",
  });

  useEffect(() => {
    if (isOwner) {
      const unsub = onSnapshot(collection(db, "audit_logs"), (snapshot) => {
        const logs: any[] = [];
        snapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));
        logs.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        setAuditLogs(logs);
      });
      return () => unsub();
    }
  }, [isOwner]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && user.emailVerified) {
        if (OWNER_EMAILS.includes(user.email!)) {
          setCurrentUserEmail(user.email!);
          setIsAuthenticated(true);
        } else {
          try {
            const adminDoc = await getDoc(doc(db, "admins", user.email!));
            if (adminDoc.exists()) {
              setCurrentUserEmail(user.email!);
              setIsAuthenticated(true);
            } else {
              setIsAuthenticated(false);
              // Clear current user explicitly if they don't have access
              setCurrentUserEmail("");
            }
          } catch (err) {
            console.error("Error Checking Admin status", err);
            setIsAuthenticated(false);
            setCurrentUserEmail("");
          }
        }
      } else {
        setIsAuthenticated(false);
        setCurrentUserEmail("");
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isOwner && activeTab === "dashboard") {
      setActiveTab("calendar");
    }
  }, [isAuthenticated, isOwner, activeTab]);

  const loadOrders = () => {
    const unsub = onSnapshot(
      collection(db, "orders"),
      (snapshot) => {
        const data: Order[] = [];
        snapshot.forEach((doc) => {
          data.push(doc.data() as Order);
        });
        data.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setOrders(data);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "orders");
      },
    );
    return unsub;
  };

  const loadPromos = () => {
    const unsub = onSnapshot(
      collection(db, "promos"),
      (snapshot) => {
        const data: Promo[] = [];
        snapshot.forEach((doc) => {
          data.push(doc.data() as Promo);
        });
        setPromos(data);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "promos");
      },
    );
    return unsub;
  };

  useEffect(() => {
    if (isAuthenticated) {
      const unsubOrders = loadOrders();
      const unsubPromos = loadPromos();
      const unsubInventory = onSnapshot(
        collection(db, "inventory"),
        (snapshot) => {
          const invData: InventoryItem[] = [];
          snapshot.forEach((doc) =>
            invData.push({ id: doc.id, ...doc.data() } as InventoryItem),
          );
          setInventory(invData);
        },
        (error) => handleFirestoreError(error, OperationType.GET, "inventory"),
      );

      const unsubTechs = onSnapshot(
        collection(db, "technicians"),
        (snapshot) => {
          const data: Technician[] = [];
          snapshot.forEach((doc) =>
            data.push({ id: doc.id, ...doc.data() } as Technician),
          );
          setTechnicians(data);
        },
        (error) =>
          handleFirestoreError(error, OperationType.GET, "technicians"),
      );

      const unsubExpenses = onSnapshot(
        collection(db, "expenses"),
        (snapshot) => {
          const data: Expense[] = [];
          snapshot.forEach((doc) =>
            data.push({ id: doc.id, ...doc.data() } as Expense),
          );
          setExpenses(
            data.sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            ),
          );
        },
        (error) => handleFirestoreError(error, OperationType.GET, "expenses"),
      );

      const unsubReports = onSnapshot(
        collection(db, "technicianReports"),
        (snapshot) => {
          const data: TechnicianReport[] = [];
          snapshot.forEach((doc) =>
            data.push({ id: doc.id, ...doc.data() } as TechnicianReport),
          );
          setTechReports(
            data.sort(
              (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime(),
            ),
          );
        },
        (error) =>
          handleFirestoreError(error, OperationType.GET, "technicianReports"),
      );

      const unsubSettings = onSnapshot(
        doc(db, "settings", "services"),
        (docSnap) => {
          if (docSnap.exists()) {
            setServicePrices(docSnap.data().prices || {});
          }
        },
        (error) => handleFirestoreError(error, OperationType.GET, "settings"),
      );

      const unsubAdmins = onSnapshot(
        collection(db, "admins"),
        (snapshot) => {
          const data: string[] = [];
          snapshot.forEach((doc) => data.push(doc.id));
          setIsAdminList(data);
        },
        (error) => {
          console.error("Admins list error: ", error);
        },
      );

      return () => {
        unsubOrders();
        unsubPromos();
        unsubInventory();
        unsubTechs();
        unsubExpenses();
        unsubReports();
        unsubSettings();
        unsubAdmins();
      };
    }
  }, [isAuthenticated]);

  const addLog = async (action: string, details: string) => {
    try {
      await setDoc(doc(collection(db, "audit_logs")), {
        action,
        details,
        userEmail: currentUserEmail,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Gagal menyimpan log:", e);
    }
  };

  const saveOrder = async (updatedOrder: Order) => {
    try {
      await updateDoc(doc(db, "orders", updatedOrder.id), { ...updatedOrder });
      addLog(
        "Edit Pesanan",
        `Mengubah pesanan #${updatedOrder.id} - ${updatedOrder.customerName}`,
      );
      setSelectedOrder(updatedOrder);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "orders");
    }
  };

  const deleteOrder = async (orderId: string) => {
    if (confirm("Apakah Anda yakin ingin menghapus pesanan ini?")) {
      try {
        await deleteDoc(doc(db, "orders", orderId));
        addLog("Hapus Pesanan", `Menghapus pesanan #${orderId}`);
        setSelectedOrder(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, "orders");
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      let isAllowed = OWNER_EMAILS.includes(user.email!);
      if (!isAllowed) {
        try {
          const adminDoc = await getDoc(doc(db, "admins", user.email!));
          isAllowed = adminDoc.exists();
        } catch (err) {
          console.error("Error reading admin status:", err);
        }
      }

      if (!isAllowed) {
        await signOut(auth);
        alert("Akun Google tidak berhak mengakses halaman admin.");
        return;
      }
      setCurrentUserEmail(user.email!);
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Gagal login:", error);
      alert("Gagal terkoneksi ke server untuk mengautentikasi.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAuthenticated(false);
  };

  const addExtraCost = () => {
    if (!selectedOrder || !newExtraCostDesc || !newExtraCostAmount) return;

    const amount = Number(newExtraCostAmount);
    if (isNaN(amount) || amount <= 0) return;

    const newExtra: ExtraCost = {
      description: newExtraCostDesc,
      amount,
      type: newExtraCostType,
    };
    const updatedOrder = {
      ...selectedOrder,
      extraCosts: [...(selectedOrder.extraCosts || []), newExtra],
    };

    saveOrder(updatedOrder);
    setNewExtraCostDesc("");
    setNewExtraCostAmount("");
    setNewExtraCostType("Jasa");
  };

  const saveInventoryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const invRef = doc(
        db,
        "inventory",
        editingInventory
          ? editingInventory.id
          : Math.random().toString(36).substring(7),
      );
      const pay = {
        name: inventoryForm.name,
        stock: Number(inventoryForm.stock),
        unit: inventoryForm.unit,
        price: Number(inventoryForm.price),
      };
      if (editingInventory) {
        await updateDoc(invRef, pay);
      } else {
        await setDoc(invRef, Object.assign(pay, { id: invRef.id }));
      }
      setIsInventoryModalOpen(false);
      setEditingInventory(null);
      setInventoryForm({ name: "", stock: "", unit: "", price: "" });
    } catch (err) {
      handleFirestoreError(
        err,
        editingInventory ? OperationType.UPDATE : OperationType.CREATE,
        "inventory",
      );
    }
  };

  const deleteInventoryItem = async (id: string) => {
    if (confirm("Yakin ingin menghapus item ini?")) {
      try {
        await deleteDoc(doc(db, "inventory", id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `inventory/${id}`);
      }
    }
  };

  const filteredOrders = orders.filter(
    (o) =>
      (o.id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (o.customerName || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      (o.phone || "").toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const completedRevenue = orders
    .filter((o) => o.status === "Selesai")
    .reduce((sum, o) => sum + calculateFinalTotal(o), 0);

  const completedTechCut = orders
    .filter((o) => o.status === "Selesai")
    .reduce((sum, o) => sum + calculateOrderSplit(o).techCut, 0);

  const completedMgmtCut = orders
    .filter((o) => o.status === "Selesai")
    .reduce((sum, o) => sum + calculateOrderSplit(o).mgmtCut, 0);

  const statValues = React.useMemo(() => {
    // 1. Determine start and end date of period
    let start = new Date(statsStartDate);
    let end = new Date(statsEndDate);
    const today = new Date();

    if (statsPeriod === "7_days") {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      start = d;
      end = today;
    } else if (statsPeriod === "30_days") {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      start = d;
      end = today;
    } else if (statsPeriod === "this_month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = today;
    } else if (statsPeriod === "last_month") {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    }

    // Set times to start and end of day to include full days
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).getTime();
    const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime();

    // Generate list of days in the range for the trend chart
    const daysList: { dateStr: string; label: string; revenue: number; expense: number; techFee: number; netProfit: number }[] = [];
    const tempDate = new Date(startMs);
    const endTmp = new Date(endMs);
    
    // Safety limit to avoid infinite loops or extremely holiday periods
    let iterations = 0;
    while (tempDate <= endTmp && iterations < 366) {
      const dateStr = tempDate.toLocaleDateString("en-CA");
      daysList.push({
        dateStr,
        label: tempDate.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        }),
        revenue: 0,
        expense: 0,
        techFee: 0,
        netProfit: 0,
      });
      tempDate.setDate(tempDate.getDate() + 1);
      iterations++;
    }

    const revenueByDayMap = new Map(daysList.map((d) => [d.dateStr, d]));

    // Aggregate orders, expenses, technicians, services, areas
    let periodRevenue = 0;
    let periodTechFee = 0;
    let periodExpense = 0;
    let completedCount = 0;

    const serviceCounts: Record<string, number> = {};
    const serviceRevenue: Record<string, number> = {};
    const areaCounts: Record<string, number> = {};
    const techPerformance: Record<string, { name: string; completedCount: number; feeEarned: number }> = {};

    orders.forEach((o) => {
      if (o.status === "Selesai" && o.createdAt) {
        const dateObj = new Date(o.createdAt);
        const orderMs = dateObj.getTime();
        
        if (orderMs >= startMs && orderMs <= endMs) {
          const finalTotal = calculateFinalTotal(o);
          const split = calculateOrderSplit(o);
          
          periodRevenue += finalTotal;
          periodTechFee += split.techCut;
          completedCount++;

          // Daily trend
          const dateStr = dateObj.toLocaleDateString("en-CA");
          if (revenueByDayMap.has(dateStr)) {
            const dayData = revenueByDayMap.get(dateStr)!;
            dayData.revenue += finalTotal;
            dayData.techFee += split.techCut;
          }

          // Services Breakdown
          if (o.items && Array.isArray(o.items)) {
            o.items.forEach((srv) => {
              const serviceName = srv.name || "Lain-lain";
              const qty = srv.quantity || 1;
              const price = srv.price || 0;
              serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + qty;
              serviceRevenue[serviceName] = (serviceRevenue[serviceName] || 0) + (price * qty);
            });
          }

          // Areas breakdown
          if (o.area) {
            areaCounts[o.area] = (areaCounts[o.area] || 0) + 1;
          }

          // Technician performance
          const techName = o.technician || "Belum Ditugaskan";
          if (!techPerformance[techName]) {
            techPerformance[techName] = { name: techName, completedCount: 0, feeEarned: 0 };
          }
          techPerformance[techName].completedCount += 1;
          techPerformance[techName].feeEarned += split.techCut;
        }
      }
    });

    expenses.forEach((e) => {
      const dateObj = new Date(e.date);
      const expenseMs = dateObj.getTime();
      if (expenseMs >= startMs && expenseMs <= endMs) {
        periodExpense += e.amount;

        // Daily trend
        const dateStr = e.date;
        if (revenueByDayMap.has(dateStr)) {
          revenueByDayMap.get(dateStr)!.expense += e.amount;
        }
      }
    });

    // Calculate net profits for days
    daysList.forEach((day) => {
      day.netProfit = day.revenue - day.expense - day.techFee;
    });

    const periodNetProfit = periodRevenue - periodExpense - periodTechFee;
    const profitMarginRatio = periodRevenue > 0 ? (periodNetProfit / periodRevenue) * 100 : 0;
    const averageOrderValue = completedCount > 0 ? periodRevenue / completedCount : 0;

    // Format top services for Pie Chart
    const topServices = Object.entries(serviceCounts)
      .map(([name, count]) => ({
        name,
        value: count,
        revenue: serviceRevenue[name] || 0,
      }))
      .sort((a, b) => b.value - a.value);

    // Format top areas
    const topAreas = Object.entries(areaCounts)
      .map(([name, count]) => ({
        name,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);

    // Format tech performance
    const techRanked = Object.values(techPerformance).sort((a, b) => b.completedCount - a.completedCount);

    return {
      startDateStr: start.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }),
      endDateStr: end.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }),
      startDateInput: start.toLocaleDateString("en-CA"),
      endDateInput: end.toLocaleDateString("en-CA"),
      periodRevenue,
      periodExpense,
      periodTechFee,
      periodNetProfit,
      profitMarginRatio,
      completedCount,
      averageOrderValue,
      revenueData: daysList,
      servicePieData: topServices.slice(0, 5),
      topServices,
      topAreas,
      techRanked,
    };
  }, [orders, expenses, statsPeriod, statsStartDate, statsEndDate]);

  const chartData = statValues;

  const COLORS = ["#0B192C", "#FFA800", "#A0ABBA", "#107C41", "#E74C3C"];

  const parsedCustomers = React.useMemo(() => {
    const custMap = new Map<string, Customer>();
    orders.forEach((o) => {
      const phoneKey = o.phone || "unknown";
      if (!custMap.has(phoneKey)) {
        custMap.set(phoneKey, {
          id: phoneKey,
          name: o.customerName || "Customer",
          phone: o.phone || "-",
          address: o.address || "-", // initial
          orderCount: 0,
          totalSpent: 0,
        });
      }
      const cust = custMap.get(phoneKey)!;
      cust.orderCount += 1;
      if (o.status === "Selesai") {
        cust.totalSpent += calculateFinalTotal(o);
      }
      cust.name = o.customerName || cust.name; // update to latest info
      cust.address = o.address || cust.address;

      const orderDate = new Date(o.createdAt).getTime();
      const existingDate = cust.lastServiceDate
        ? new Date(cust.lastServiceDate).getTime()
        : 0;
      if (orderDate > existingDate && o.status === "Selesai") {
        cust.lastServiceDate = o.createdAt;
      }
    });
    return Array.from(custMap.values()).sort(
      (a, b) => b.orderCount - a.orderCount,
    );
  }, [orders]);

  const [newTechName, setNewTechName] = useState("");
  const [newTechPhone, setNewTechPhone] = useState("");
  const [newTechLocation, setNewTechLocation] = useState("");

  const saveTechnician = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTechName || !newTechPhone || !newTechLocation) return;
    try {
      await setDoc(doc(collection(db, "technicians")), {
        name: newTechName,
        phone: newTechPhone,
        location: newTechLocation,
      });
      setNewTechName("");
      setNewTechPhone("");
      setNewTechLocation("");
    } catch (err) {
      console.error(err);
      alert("Gagal simpan teknisi");
    }
  };

  const deleteTechnician = async (id: string) => {
    if (confirm("Hapus teknisi?")) {
      await deleteDoc(doc(db, "technicians", id));
    }
  };

  const [newExpDate, setNewExpDate] = useState(
    new Date().toLocaleDateString("en-CA"),
  );
  const [newExpDesc, setNewExpDesc] = useState("");
  const [newExpAmount, setNewExpAmount] = useState("");

  const saveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpDesc || !newExpAmount) return;
    try {
      await setDoc(doc(collection(db, "expenses")), {
        date: newExpDate,
        description: newExpDesc,
        amount: Number(newExpAmount),
      });
      addLog("Tambah Pengeluaran", `Rp${newExpAmount} untuk ${newExpDesc}`);
      setNewExpDesc("");
      setNewExpAmount("");
    } catch (err) {
      console.error(err);
      alert("Gagal simpan pengeluaran");
    }
  };

  const deleteExpense = async (id: string) => {
    if (confirm("Hapus pengeluaran?")) {
      await deleteDoc(doc(db, "expenses", id));
      addLog("Hapus Pengeluaran", `Menghapus data pengeluaran ID ${id}`);
    }
  };

  // Print Layout removed - now using jsPDF

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-[#0B192C] text-white rounded-2xl flex items-center justify-center mb-4">
              <LogIn className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-[#0B192C]">
              Admin JAGO AC
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Silakan login untuk kelola pesanan
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <button
              type="submit"
              className="w-full bg-[#0B192C] hover:bg-[#1A283C] text-white font-bold py-3.5 rounded-xl transition-colors"
            >
              Login dengan Google
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6F8] font-sans text-slate-800 print:hidden">
      {/* Top Navbar */}
      <header className="bg-[#0B192C] text-white py-4 px-6 sticky top-0 z-40 flex justify-between items-center shadow-lg h-[72px]">
        <div className="flex items-center space-x-1.5 uppercase leading-none">
          <span
            className="text-[20px] sm:text-[24px] font-black tracking-[-0.04em] text-white"
            style={{
              fontFamily:
                'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            }}
          >
            JAGO
          </span>
          <span
            className="text-[12px] sm:text-[14px] font-black px-1.5 rounded-[4px] bg-[#FFA800] text-[#0B192C]"
            style={{
              fontFamily:
                'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
              paddingBottom: "2px",
            }}
          >
            AC
          </span>
          <span className="ml-2 text-[10px] sm:text-xs font-bold text-gray-400">
            Dashbor
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-sm hidden lg:block">
            Welcome,{" "}
            <span className="font-bold text-[#FFA800]">
              {auth.currentUser?.email?.includes("anjaspratama")
                ? "Owner"
                : "Admin"}
            </span>
          </div>

          {/* Category Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center gap-2 bg-[#1A283C] hover:bg-[#25354C] px-3 sm:px-4 py-2 rounded-xl transition-all border border-white/10 active:scale-95"
            >
              <Menu className="w-5 h-5 text-[#FFA800]" />
              <span className="hidden sm:inline font-bold text-sm">
                Menu Navigasi
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${isMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setIsMenuOpen(false)}
                ></div>
                <div className="absolute right-0 mt-2 w-64 md:w-[500px] bg-white rounded-2xl shadow-2xl py-2 z-20 border border-gray-100 max-h-[75vh] sm:max-h-[85vh] overflow-y-auto overflow-x-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
                  <div className="px-4 py-2 border-b border-gray-50 mb-1">
                    <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                      Pilih Kategori
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 px-1">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id as any);
                          setIsMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm rounded-xl transition-colors ${activeTab === tab.id ? "bg-[#F4F6F8] text-[#0B192C] font-black" : "text-gray-600 hover:bg-gray-50"}`}
                      >
                        <span
                          className={
                            activeTab === tab.id
                              ? "text-[#FFA800]"
                              : (tab as any).color || "text-gray-400"
                          }
                        >
                          {tab.icon}
                        </span>
                        <span className="truncate">{tab.label}</span>
                        {(tab as any).badge > 0 && (
                          <span className="ml-2 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                            {(tab as any).badge}
                          </span>
                        )}
                        {activeTab === tab.id && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#FFA800]"></div>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-50">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <X className="w-4 h-4" /> Logout
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="hidden sm:block text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full transition-colors active:scale-95 font-bold"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <FileText className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-bold truncate">Total Order</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#0B192C]">
              {orders.length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="w-5 h-5 text-yellow-500" />
              <span className="text-sm font-bold truncate">Menunggu</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#0B192C]">
              {
                orders.filter(
                  (o) =>
                    o.status === "Menunggu Konfirmasi" ||
                    o.status === "Pending",
                ).length
              }
            </p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <RefreshCw className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-bold truncate">Dikerjakan</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-[#0B192C]">
              {orders.filter((o) => o.status === "Sedang Dikerjakan").length}
            </p>
          </div>
          <div className="bg-[#F4F6F8]/50 p-3 sm:p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-xs sm:text-sm font-bold truncate">
                Selesai (Kotor)
              </span>
            </div>
            <p className="text-[14px] sm:text-lg md:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
              {formatCurrency(completedRevenue)}
            </p>
          </div>
          <div className="bg-[#F4F6F8]/50 p-3 sm:p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <CheckCircle className="w-5 h-5 text-blue-500" />
              <span className="text-xs sm:text-sm font-bold truncate">Fee Teknisi</span>
            </div>
            <p className="text-[14px] sm:text-lg md:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
              {formatCurrency(completedTechCut)}
            </p>
          </div>
          <div className="bg-[#F4F6F8]/50 p-3 sm:p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="text-xs sm:text-sm font-bold truncate">
                Pendapatan JAGO AC
              </span>
            </div>
            <p className="text-[14px] sm:text-lg md:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
              {formatCurrency(completedMgmtCut)}
            </p>
          </div>
        </div>

        {/* Current Tab Title (Mobile Header) */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-gray-100 shadow-sm relative">
            <span className="text-[#FFA800]">{currentTab?.icon}</span>
            <h2 className="font-black text-[#0B192C] uppercase tracking-tight">
              {currentTab?.label}
            </h2>
            {(currentTab as any)?.badge > 0 && (
              <span className="bg-red-500 text-white text-[11px] font-black px-2 py-0.5 rounded-full ring-2 ring-white">
                {(currentTab as any).badge}
              </span>
            )}
          </div>
        </div>

        {/* Categories section was here, moved to dropdown */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full"
          >
            {activeTab === "calendar" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#F4F6F8]/50 overflow-x-auto no-scrollbar">
                  <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-[#0B192C] flex items-center gap-2">
                      <Calendar className="w-5 h-5" /> Jadwal Lapangan
                    </h2>
                    <div className="bg-white border border-gray-200 rounded-xl flex items-center px-2 py-1">
                      <button
                        onClick={() => handleMonthNav(-1)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <span className="px-4 font-bold text-sm min-w-[140px] text-center">
                        {indonesianMonths[currentCalendarMonth.getMonth()]}{" "}
                        {currentCalendarMonth.getFullYear()}
                      </span>
                      <button
                        onClick={() => handleMonthNav(1)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex bg-white border border-gray-200 rounded-xl p-1">
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                      <span className="text-[10px] font-bold text-gray-500 uppercase">
                        Baru
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                      <span className="text-[10px] font-bold text-gray-500 uppercase">
                        Otw
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                      <span className="text-[10px] font-bold text-gray-500 uppercase">
                        Selesai
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 sm:p-6 bg-white overflow-x-auto">
                  <div className="min-w-[700px]">
                    <div className="grid grid-cols-7 mb-2">
                      {indonesianDays.map((day) => (
                        <div
                          key={day}
                          className="text-center text-xs font-black text-gray-400 uppercase py-2"
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1 sm:gap-2">
                      {getCalendarDays().map((day, idx) => {
                        const dateStr = day
                          ? `${currentCalendarMonth.getFullYear()}-${String(currentCalendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                          : "";
                        const dayOrders = day
                          ? ordersByDate[dateStr] || []
                          : [];

                        return (
                          <div
                            key={idx}
                            className={`min-h-[100px] sm:min-h-[140px] border border-gray-100 rounded-2xl p-2 sm:p-3 relative flex flex-col ${day === null ? "bg-gray-50/50" : "bg-white hover:border-[#0B192C]/20 transition-all"}`}
                          >
                            {day && (
                              <>
                                <span
                                  className={`text-sm font-bold mb-2 ${new Date().toLocaleDateString("en-CA") === dateStr ? "bg-[#0B192C] text-white w-7 h-7 flex items-center justify-center rounded-full" : "text-gray-400"}`}
                                >
                                  {day}
                                </span>
                                <div className="flex flex-col gap-1 overflow-y-auto max-h-[85px] no-scrollbar">
                                  {dayOrders.map((order) => (
                                    <button
                                      key={order.id}
                                      onClick={() => setSelectedOrder(order)}
                                      className={`text-[9px] sm:text-[10px] p-1.5 rounded-lg text-left truncate font-bold transition-all hover:scale-[1.02] active:scale-95 ${
                                        order.status === "Selesai"
                                          ? "bg-green-50 text-green-700 border border-green-200"
                                          : order.status === "Sedang Dikerjakan"
                                            ? "bg-orange-50 text-orange-700 border border-orange-200"
                                            : order.status ===
                                                "Teknisi Ditugaskan"
                                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                                              : "bg-gray-100 text-gray-600 border border-gray-200"
                                      }`}
                                      title={`${order.customerName} - ${order.time}`}
                                    >
                                      <div className="flex justify-between items-center opacity-70 mb-0.5">
                                        <span>{order.time}</span>
                                      </div>
                                      <div className="truncate">
                                        {order.customerName}
                                      </div>
                                      <div className="text-[8px] flex items-center gap-1 mt-0.5 opacity-80 uppercase font-black">
                                        <MapPin className="w-2 h-2" />{" "}
                                        {order.area}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "whatsapp" && (
              <div className="space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#25D366] p-6 sm:p-10 rounded-[30px] sm:rounded-[40px] text-white shadow-xl shadow-green-200/50 relative overflow-hidden"
                >
                  <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="bg-white/20 p-2 rounded-2xl">
                          <MessageCircle className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
                          WhatsApp Helper
                        </h2>
                      </div>
                      <p className="text-green-50 opacity-90 text-sm sm:text-base max-w-md font-medium leading-relaxed">
                        Kirim pesan profesional ke pelanggan (Konfirmasi,
                        Teknisi, & Invoice) tanpa perlu mengetik ulang
                        satu-persatu.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 bg-black/10 backdrop-blur-md p-5 rounded-3xl border border-white/20 max-w-xs">
                      <h4 className="text-xs font-black uppercase tracking-widest mb-1 flex items-center gap-2">
                        <Sparkles className="w-3 h-3 text-yellow-300" /> Cara
                        Pakai:
                      </h4>
                      <ol className="text-[11px] font-bold space-y-1 opacity-90">
                        <li>1. Pilih nama pelanggan di daftar kiri</li>
                        <li>2. Pilih jenis pesan yang dibutuhkan</li>
                        <li>3. Klik "Kirim ke WhatsApp"</li>
                      </ol>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-12 translate-x-12 blur-3xl"></div>
                </motion.div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Step 1: Customer List Sidebar */}
                  <div className="lg:col-span-4 bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col lg:sticky lg:top-24">
                    <div className="flex bg-[#F4F6F8] p-1.5 rounded-2xl w-full mb-6">
                      <button
                        onClick={() => setWaHelperTab("pelanggan")}
                        className={`flex-1 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${waHelperTab === "pelanggan" ? "bg-white shadow-sm text-[#0B192C]" : "text-gray-500 hover:text-[#0B192C]"}`}
                      >
                        Order Jago AC
                      </button>
                      <button
                        onClick={() => setWaHelperTab("database")}
                        className={`flex-1 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${waHelperTab === "database" ? "bg-white shadow-sm text-[#0B192C]" : "text-gray-500 hover:text-[#0B192C]"}`}
                      >
                        Database Kontak
                      </button>
                    </div>

                    {waHelperTab === "pelanggan" && (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-[#0B192C] text-[#FFA800] rounded-xl flex items-center justify-center text-xs font-black shadow-lg shadow-blue-900/20">
                              1
                            </div>
                            <h3 className="font-black text-[#0B192C] text-sm uppercase tracking-wider">
                              Antrean Pesanan
                            </h3>
                          </div>
                          <button
                            onClick={() => {
                              setIsMultiSelect(!isMultiSelect);
                              setSelectedOrderIds([]);
                              setSelectedWaOrder(null);
                            }}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95 shadow-sm border ${
                              isMultiSelect
                                ? "bg-[#0B192C] text-[#FFA800] border-[#0B192C]"
                                : "bg-[#EBFAEF] text-[#25D366] border-[#25D366]/20"
                            }`}
                          >
                            {isMultiSelect ? "Selesai Pilih" : "Pilih Banyak"}
                          </button>
                        </div>

                        <div className="bg-yellow-50 p-3 rounded-2xl mb-6 border border-yellow-100 flex items-start gap-3">
                          <div className="w-5 h-5 bg-[#FFA800] text-[#0B192C] rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">
                            !
                          </div>
                          <p className="text-[10px] sm:text-[11px] text-[#0B192C] font-bold leading-tight">
                            {isMultiSelect
                              ? "Klik pada kotak centang untuk memilih beberapa pelanggan sekaligus."
                              : "Pilih salah satu nama pelanggan di bawah ini untuk memunculkan pilihan pesan WhatsApp."}
                          </p>
                        </div>

                        <div className="relative mb-6">
                          <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Cari nama atau no. HP..."
                            className="w-full pl-12 pr-4 py-3.5 bg-[#F4F6F8] border border-transparent rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#25D366]/20 focus:bg-white focus:border-gray-200 transition-all"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        </div>

                        <div className="flex-1 overflow-y-auto max-h-[500px] lg:max-h-[600px] pr-2 space-y-3 custom-scrollbar">
                          {orders
                            .filter(
                              (o) =>
                                o.customerName
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) ||
                                o.phone.includes(searchQuery),
                            )
                            .sort(
                              (a, b) =>
                                new Date(b.date).getTime() -
                                new Date(a.date).getTime(),
                            )
                            .slice(0, 30)
                            .map((o, idx) => {
                              const isActive = selectedWaOrder?.id === o.id;
                              const isMultiActive = selectedOrderIds.includes(
                                o.id,
                              );
                              const rec = getRecommendation(o.date);

                              return (
                                <motion.div
                                  layout
                                  key={o.id}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.03 }}
                                  className="relative"
                                >
                                  <button
                                    onClick={() => {
                                      if (isMultiSelect) {
                                        setSelectedOrderIds((prev) =>
                                          prev.includes(o.id)
                                            ? prev.filter((id) => id !== o.id)
                                            : [...prev, o.id],
                                        );
                                      } else {
                                        setSelectedWaOrder(o);
                                        if (window.innerWidth < 1024) {
                                          document
                                            .getElementById("whatsapp-messages")
                                            ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "start",
                                            });
                                        }
                                      }
                                    }}
                                    className={`w-full p-4 rounded-3xl text-left border transition-all active:scale-[0.97] group relative overflow-hidden ${
                                      isActive || isMultiActive
                                        ? "bg-gradient-to-br from-[#EBFAEF] to-white border-[#25D366] shadow-md ring-1 ring-[#25D366]/50"
                                        : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm"
                                    }`}
                                  >
                                    {(isActive || isMultiActive) && (
                                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#25D366]"></div>
                                    )}

                                    <div className="flex justify-between items-start mb-2">
                                      <div className="flex-1 min-w-0 flex items-center gap-2">
                                        {isMultiSelect && (
                                          <div
                                            className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-colors ${isMultiActive ? "bg-[#25D366] border-[#25D366]" : "border-gray-200 bg-gray-50"}`}
                                          >
                                            {isMultiActive && (
                                              <CheckCircle className="w-3.5 h-3.5 text-white" />
                                            )}
                                          </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <h4
                                              className={`font-black text-sm truncate ${isActive || isMultiActive ? "text-[#0B192C]" : "text-gray-700"}`}
                                            >
                                              {o.customerName}
                                            </h4>
                                            {rec && (
                                              <span
                                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[8px] font-black uppercase ${rec.color}`}
                                              >
                                                {rec.icon} {rec.label}
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-[10px] text-gray-400 font-bold tracking-tight">
                                            #{o.id} • {o.area}
                                          </p>
                                        </div>
                                      </div>
                                      <span
                                        className={`text-[8px] px-2 py-1 rounded-lg font-black uppercase flex-shrink-0 ml-2 ${
                                          o.status === "Selesai"
                                            ? "bg-green-100 text-green-600"
                                            : o.status === "Sedang Dikerjakan"
                                              ? "bg-orange-100 text-orange-600"
                                              : "bg-blue-100 text-blue-600"
                                        }`}
                                      >
                                        {o.status === "Pending"
                                          ? "Baru"
                                          : o.status}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold border-t border-gray-50 pt-3 mt-1">
                                      <div className="flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" />
                                        <span>{o.date}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Clock className="w-3 h-3" />
                                        <span>{o.time}</span>
                                      </div>
                                    </div>
                                  </button>
                                </motion.div>
                              );
                            })}
                          {orders.length === 0 && (
                            <div className="text-center py-10">
                              <div className="w-12 h-12 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Search className="w-6 h-6" />
                              </div>
                              <p className="text-gray-400 text-xs italic">
                                Data pesanan tidak ditemukan.
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {waHelperTab === "database" && (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-[#0B192C] text-[#FFA800] rounded-xl flex items-center justify-center text-xs font-black shadow-lg shadow-blue-900/20">
                              <Users className="w-4 h-4" />
                            </div>
                            <h3 className="font-black text-[#0B192C] text-sm uppercase tracking-wider">
                              Database Kontak
                            </h3>
                          </div>
                          <button
                            onClick={() => {
                              if (
                                selectedContactIds.length ===
                                  uploadedContacts.length &&
                                uploadedContacts.length > 0
                              ) {
                                setSelectedContactIds([]);
                              } else {
                                setSelectedContactIds(
                                  uploadedContacts.map((c) => c.id),
                                );
                              }
                            }}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all active:scale-95 shadow-sm border bg-[#EBFAEF] text-[#25D366] border-[#25D366]/20`}
                          >
                            {selectedContactIds.length > 0 &&
                            selectedContactIds.length ===
                              uploadedContacts.length
                              ? "Batal Semua"
                              : "Pilih Semua"}
                          </button>
                        </div>

                        <div className="bg-blue-50 p-4 rounded-2xl mb-6 border border-blue-100 hover:bg-blue-100 transition-colors">
                          <label className="block w-full text-center cursor-pointer">
                            <input
                              type="file"
                              accept=".vcf,.csv,.txt"
                              className="hidden"
                              onChange={handleFileUploadContact}
                            />
                            <div className="flex flex-col items-center gap-2">
                              <Download className="w-6 h-6 text-blue-500" />
                              <span className="text-xs font-bold text-blue-700">
                                Upload File .VCF / .CSV Dari HP
                              </span>
                            </div>
                          </label>
                        </div>

                        {uploadedContacts.length > 0 && (
                          <div className="relative mb-6">
                            <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Cari kontak..."
                              className="w-full pl-12 pr-4 py-3.5 bg-[#F4F6F8] border border-transparent rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#25D366]/20 focus:bg-white focus:border-gray-200 transition-all"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                            />
                          </div>
                        )}

                        <div className="flex-1 overflow-y-auto max-h-[400px] lg:max-h-[500px] pr-2 space-y-2 custom-scrollbar">
                          {uploadedContacts
                            .filter(
                              (c) =>
                                c.name
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) ||
                                c.phone.includes(searchQuery),
                            )
                            .map((c, idx) => {
                              const isMultiActive = selectedContactIds.includes(
                                c.id,
                              );
                              return (
                                <motion.div
                                  layout
                                  key={c.id}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.01 }}
                                  className="relative"
                                >
                                  <button
                                    onClick={() => {
                                      setSelectedContactIds((prev) =>
                                        prev.includes(c.id)
                                          ? prev.filter((id) => id !== c.id)
                                          : [...prev, c.id],
                                      );
                                    }}
                                    className={`w-full p-4 rounded-3xl text-left border transition-all active:scale-[0.97] group relative overflow-hidden ${
                                      isMultiActive
                                        ? "bg-gradient-to-br from-[#EBFAEF] to-white border-[#25D366] shadow-md ring-1 ring-[#25D366]/50"
                                        : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm"
                                    }`}
                                  >
                                    {isMultiActive && (
                                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#25D366]"></div>
                                    )}
                                    <div className="flex justify-between items-center relative z-10">
                                      <div className="flex-1 min-w-0 flex items-center gap-3">
                                        <div
                                          className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-colors ${isMultiActive ? "bg-[#25D366] border-[#25D366]" : "border-gray-200 bg-gray-50"}`}
                                        >
                                          {isMultiActive && (
                                            <CheckCircle className="w-3.5 h-3.5 text-white" />
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <h4
                                            className={`font-black text-sm truncate ${isMultiActive ? "text-[#0B192C]" : "text-gray-700"}`}
                                          >
                                            {c.name}
                                          </h4>
                                          <p className="text-[10px] text-gray-400 font-bold tracking-tight">
                                            {c.phone}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                </motion.div>
                              );
                            })}
                          {uploadedContacts.length === 0 && (
                            <div className="text-center py-10">
                              <div className="w-12 h-12 bg-gray-50 text-gray-300 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users className="w-6 h-6" />
                              </div>
                              <p className="text-gray-400 text-xs italic">
                                Silakan upload kontak database.
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Step 2: Message Templates & Live Preview */}
                  <div
                    id="whatsapp-messages"
                    className="lg:col-span-8 space-y-8 min-h-[600px]"
                  >
                    <AnimatePresence mode="wait">
                      {waHelperTab === "database" ? (
                        <motion.div
                          key="database-view"
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-8"
                        >
                          <div className="bg-[#0B192C] p-8 rounded-[40px] text-white shadow-xl shadow-blue-200/20 relative overflow-hidden">
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                                  <MessageCircle className="w-6 h-6 text-[#FFA800]" />
                                </div>
                                <h3 className="text-xl font-black">
                                  Custom WA Blast Database (
                                  {selectedContactIds.length} Kontak Terpilih)
                                </h3>
                              </div>
                              <p className="text-xs text-blue-100 opacity-80 max-w-md font-medium leading-relaxed">
                                Pilih daftar kontak di kiri, atur template pesan
                                di bawah, dan klik pada tombol aksi untuk
                                mengirim pesan satu-persatu ke klien Anda.
                              </p>
                            </div>
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-10 translate-x-10 blur-2xl"></div>
                          </div>

                          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm space-y-4">
                            <div className="flex items-center gap-4 mb-4">
                              <div className="w-10 h-10 bg-[#0B192C] text-[#FFA800] rounded-2xl flex items-center justify-center text-sm font-black shadow-lg shadow-blue-900/20">
                                2
                              </div>
                              <h3 className="font-black text-[#0B192C] text-base uppercase tracking-tight">
                                Kustomisasi Template
                              </h3>
                            </div>
                            <p className="text-xs text-gray-500 font-bold mb-2">
                              Gunakan <code>{`{nama}`}</code> untuk otomatis
                              mengganti dengan nama pelanggan.
                            </p>
                            <textarea
                              className="w-full bg-gray-50 border border-gray-200 p-4 rounded-3xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#25D366] resize-none"
                              rows={5}
                              value={blastMessage}
                              onChange={(e) => setBlastMessage(e.target.value)}
                            />
                          </div>

                          {selectedContactIds.length > 0 && (
                            <div className="space-y-4">
                              <h3 className="font-black text-[#0B192C] text-base uppercase tracking-tight mt-8 mb-4">
                                Mulai Mengirim WA:
                              </h3>
                              {uploadedContacts
                                .filter((c) =>
                                  selectedContactIds.includes(c.id),
                                )
                                .map((c, i) => {
                                  const message = blastMessage.replace(
                                    /{nama}/gi,
                                    c.name,
                                  );
                                  const waNumber = c.phone.replace(/^0/, "62");
                                  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

                                  return (
                                    <motion.div
                                      initial={{ opacity: 0, y: 10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      transition={{ delay: i * 0.05 }}
                                      key={c.id}
                                      className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-6 group"
                                    >
                                      <div className="flex items-center gap-4 w-full sm:w-auto">
                                        <div className="w-12 h-12 bg-[#F4F6F8] text-[#0B192C] rounded-2xl flex items-center justify-center font-black text-lg">
                                          {c.name.charAt(0)}
                                        </div>
                                        <div>
                                          <h4 className="font-black text-[#0B192C] text-sm truncate max-w-[140px] sm:max-w-[280px]">
                                            {c.name}
                                          </h4>
                                          <p className="text-[10px] text-gray-400 font-bold">
                                            {c.phone}
                                          </p>
                                        </div>
                                      </div>

                                      <a
                                        href={waLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-gray-50 hover:bg-[#25D366] hover:text-white rounded-xl text-xs font-black transition-all border border-gray-100"
                                      >
                                        <Send className="w-4 h-4" /> Kirim Pesan
                                      </a>
                                    </motion.div>
                                  );
                                })}
                            </div>
                          )}
                        </motion.div>
                      ) : !selectedWaOrder && selectedOrderIds.length === 0 ? (
                        <motion.div
                          key="empty-state"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-white p-12 sm:p-24 rounded-[40px] border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-center h-full"
                        >
                          <div className="relative mb-8">
                            <div className="w-24 h-24 bg-[#F4F6F8] text-gray-300 rounded-[40px] flex items-center justify-center rotate-6 scale-110">
                              <MessageCircle className="w-12 h-12" />
                            </div>
                            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white shadow-xl rounded-[30px] flex items-center justify-center -rotate-6 animate-bounce">
                              <Sparkles className="w-8 h-8 text-[#FFA800]" />
                            </div>
                          </div>
                          <h3 className="text-xl sm:text-2xl font-black text-[#0B192C]">
                            Langkah Terakhir Menanti
                          </h3>
                          <p className="text-gray-400 text-sm sm:text-base max-w-sm mt-4 italic leading-relaxed">
                            Pilih pelanggan dari daftar di sebelah kiri untuk
                            mulai menggunakan template pesan otomatis yang telah
                            disiapkan.
                          </p>
                        </motion.div>
                      ) : isMultiSelect ? (
                        <motion.div
                          key="multi-view"
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-8"
                        >
                          <div className="bg-[#0B192C] p-8 rounded-[40px] text-white shadow-xl shadow-blue-200/20 relative overflow-hidden">
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                                  <Users className="w-6 h-6 text-[#FFA800]" />
                                </div>
                                <h3 className="text-xl font-black">
                                  Mode Kirim Massal ({selectedOrderIds.length}{" "}
                                  Penerima)
                                </h3>
                              </div>
                              <p className="text-xs text-blue-100 opacity-80 max-w-md font-medium leading-relaxed">
                                Anda telah memilih beberapa pelanggan. Silakan
                                pilih jenis pesan dan kirimkan satu per satu di
                                bawah ini.
                              </p>
                            </div>
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-10 translate-x-10 blur-2xl"></div>
                          </div>

                          <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 bg-[#0B192C] text-[#FFA800] rounded-2xl flex items-center justify-center text-sm font-black shadow-lg shadow-blue-900/20">
                              2
                            </div>
                            <h3 className="font-black text-[#0B192C] text-base uppercase tracking-tight">
                              Antrean Pengiriman WA
                            </h3>
                          </div>

                          <div className="space-y-4">
                            {orders
                              .filter((o) => selectedOrderIds.includes(o.id))
                              .map((o, i) => (
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.05 }}
                                  key={o.id}
                                  className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-6 group"
                                >
                                  <div className="flex items-center gap-4 w-full sm:w-auto">
                                    <div className="w-12 h-12 bg-[#F4F6F8] text-[#0B192C] rounded-2xl flex items-center justify-center font-black text-lg">
                                      {o.customerName.charAt(0)}
                                    </div>
                                    <div>
                                      <h4 className="font-black text-[#0B192C] text-sm">
                                        {o.customerName}
                                      </h4>
                                      <p className="text-[10px] text-gray-400 font-bold">
                                        {o.phone} • {o.area}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                    {whatsappTemplates.map((tpl) => {
                                      const message = tpl.message(o);
                                      const waNumber = o.phone.replace(
                                        /^0/,
                                        "62",
                                      );
                                      const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
                                      return (
                                        <a
                                          key={tpl.id}
                                          href={waLink}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="flex-1 sm:flex-none flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-[#25D366] hover:text-white rounded-xl text-[10px] font-black transition-all border border-gray-100"
                                        >
                                          <Send className="w-3 h-3" />{" "}
                                          {tpl.title}
                                        </a>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              ))}
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={selectedWaOrder.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-8"
                        >
                          {/* Selected Customer Header */}
                          <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-[#F4F6F8] to-transparent pointer-events-none"></div>
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-6 relative z-10">
                              <div className="flex items-center gap-5">
                                <div className="w-16 h-16 bg-[#EBFAEF] text-[#25D366] rounded-3xl flex items-center justify-center font-black text-2xl shadow-inner group-hover:scale-105 transition-transform duration-500">
                                  {selectedWaOrder.customerName.charAt(0)}
                                </div>
                                <div>
                                  <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-lg sm:text-xl font-black text-[#0B192C]">
                                      {selectedWaOrder.customerName}
                                    </h3>
                                    <span className="bg-[#0B192C] text-[#FFA800] text-[9px] font-black px-2 py-0.5 rounded-full tracking-tighter">
                                      #{selectedWaOrder.id}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <p className="text-sm text-gray-500 font-bold flex items-center gap-1.5">
                                      <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />{" "}
                                      {selectedWaOrder.phone}
                                    </p>
                                    <p className="text-sm text-gray-500 font-bold flex items-center gap-1.5">
                                      <MapPin className="w-3.5 h-3.5 text-red-400" />{" "}
                                      {selectedWaOrder.area}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <motion.button
                                whileHover={{ scale: 1.1, rotate: 90 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setSelectedWaOrder(null)}
                                className="absolute top-0 right-0 sm:relative p-3 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-colors sm:self-center"
                              >
                                <X className="w-5 h-5 text-gray-400" />
                              </motion.button>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 bg-[#0B192C] text-[#FFA800] rounded-2xl flex items-center justify-center text-sm font-black shadow-lg shadow-blue-900/20">
                              2
                            </div>
                            <div>
                              <h3 className="font-black text-[#0B192C] text-base uppercase tracking-tight">
                                Katalog Pesan Automasi
                              </h3>
                              <p className="text-xs text-gray-400 font-bold">
                                Pilih salah satu pesan di bawah ini untuk
                                dikirim ke WhatsApp pelanggan.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pb-20">
                            {whatsappTemplates.map((tpl, i) => {
                              const message = tpl.message(selectedWaOrder);
                              const waNumber = selectedWaOrder.phone.replace(
                                /^0/,
                                "62",
                              );
                              const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

                              // Custom logic for "Suggested" Badge
                              const isSuggested =
                                (tpl.id === "confirm" &&
                                  (selectedWaOrder.status === "Pending" ||
                                    selectedWaOrder.status ===
                                      "Menunggu Konfirmasi")) ||
                                (tpl.id === "assign" &&
                                  selectedWaOrder.status ===
                                    "Teknisi Ditugaskan") ||
                                (tpl.id === "finished" &&
                                  selectedWaOrder.status ===
                                    "Sedang Dikerjakan");

                              const getDescription = (id: string) => {
                                switch (id) {
                                  case "confirm":
                                    return "Konfirmasi jadwal dan alamat setelah pesanan masuk.";
                                  case "assign":
                                    return "Berikan informasi mendalam mengenai teknisi yang akan datang.";
                                  case "finished":
                                    return "Detail pengerjaan selesai, jumlah tagihan, dan instruksi bayar.";
                                  case "followup_3m":
                                    return "Pesan rutin 3 bulan agar AC tetap dingin & awet.";
                                  case "followup_6m":
                                    return "Pesan edukasi bahaya debu & tagihan listrik membengkak.";
                                  case "followup_1y":
                                    return "Pesan peringatan risiko kerusakan permanen kompresor.";
                                  default:
                                    return "";
                                }
                              };

                              return (
                                <motion.div
                                  key={tpl.id}
                                  initial={{ opacity: 0, y: 15 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.1 }}
                                  className={`bg-white rounded-[40px] shadow-sm border p-1 flex flex-col transition-all hover:shadow-xl hover:shadow-gray-200/50 ${isSuggested ? "border-[#25D366] text-white ring-4 ring-[#25D366]/5" : "border-gray-100"}`}
                                >
                                  <div className="p-6 pb-4">
                                    <div className="flex justify-between items-start mb-4">
                                      <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-gray-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                          {tpl.icon}
                                        </div>
                                        <div>
                                          <h4 className="font-black text-[#0B192C] text-sm">
                                            {tpl.title}
                                          </h4>
                                          {isSuggested && (
                                            <span className="text-[10px] text-[#25D366] font-black uppercase tracking-widest">
                                              Disarankan
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <p className="text-[11px] text-gray-500 font-bold mb-4 leading-relaxed leading-relaxed">
                                      {getDescription(tpl.id)}
                                    </p>
                                  </div>

                                  {/* WhatsApp Style Bubbles Preview */}
                                  <div className="bg-[#E5DDD5] mx-4 p-4 rounded-[30px] border border-gray-200/50 relative min-h-[140px] flex flex-col items-end">
                                    <div className="absolute inset-0 opacity-10 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat bg-center"></div>
                                    <div className="relative z-10 bg-[#DCF8C6] p-3 rounded-2xl rounded-tr-none shadow-sm max-w-[90%] text-[10px] sm:text-[11px] text-gray-800 whitespace-pre-wrap font-medium leading-relaxed">
                                      {message}
                                      <div className="text-right text-[8px] text-gray-500 mt-1 uppercase font-black">
                                        Just Now
                                      </div>
                                    </div>
                                    <div className="w-3 h-3 bg-[#DCF8C6] absolute -right-1 top-0 rounded-bl-full"></div>
                                  </div>

                                  <div className="p-6 pt-4 mt-auto">
                                    <div className="flex gap-3">
                                      <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => copyToClipboard(message)}
                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-4 rounded-2xl transition-all shadow-sm flex items-center justify-center group"
                                        title="Salin Teks"
                                      >
                                        <Copy className="w-5 h-5 group-hover:rotate-6 transition-transform" />
                                      </motion.button>
                                      <motion.a
                                        whileHover={{ scale: 1.02, x: 5 }}
                                        whileTap={{ scale: 0.98 }}
                                        href={waLink}
                                        target="_blank"
                                        className="flex-1 bg-[#25D366] text-white py-4 rounded-[24px] text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 hover:brightness-105 active:scale-95 shadow-lg shadow-green-100 border-b-4 border-green-700"
                                      >
                                        <Send className="w-4 h-4" />
                                        <span>Kirim ke WhatsApp</span>
                                      </motion.a>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "dashboard" && (
              <div className="space-y-6">
                {/* Header & Date Range Pickers */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#F4F6F8]/50">
                  <div>
                    <h2 className="text-xl font-bold text-[#0B192C] flex items-center gap-2">
                      <BarChart2 className="w-6 h-6 text-blue-600" /> Statistik & Analisis Data
                    </h2>
                    <p className="text-xs text-gray-500 mt-1 font-medium">
                      Pantau kinerja keuangan, rincian pengeluaran, produktivitas teknisi, dan layanan terpopuler.
                    </p>
                  </div>
                  
                  {/* Period Selector Tabs */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="bg-gray-100 p-1 rounded-2xl flex flex-wrap gap-1">
                      {[
                        { id: "7_days", label: "7 Hari" },
                        { id: "30_days", label: "30 Hari" },
                        { id: "this_month", label: "Bulan Ini" },
                        { id: "last_month", label: "Bulan Lalu" },
                        { id: "custom", label: "Kustom" },
                      ].map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setStatsPeriod(p.id as any)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            statsPeriod === p.id
                              ? "bg-[#0B192C] text-[#FFA800] shadow-sm"
                              : "text-gray-600 hover:text-gray-900"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {statsPeriod === "custom" && (
                      <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm animate-fade-in">
                        <input
                          type="date"
                          value={statsStartDate}
                          onChange={(e) => setStatsStartDate(e.target.value)}
                          className="px-2 py-1 text-xs font-bold text-gray-700 outline-none bg-transparent"
                        />
                        <span className="text-xs text-gray-400 font-bold">s/d</span>
                        <input
                          type="date"
                          value={statsEndDate}
                          onChange={(e) => setStatsEndDate(e.target.value)}
                          className="px-2 py-1 text-xs font-bold text-gray-700 outline-none bg-transparent"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Subtitle showing localized active period */}
                <div className="text-xs text-gray-500 font-black flex items-center gap-1.5 px-1 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
                  MENAMPILKAN DATA: <span className="text-[#0B192C] underline">{statValues.startDateStr} s/d {statValues.endDateStr}</span>
                </div>

                {/* High Level KPI Cards Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Gross Revenue */}
                  <motion.div
                    whileHover={{ y: -4 }}
                    className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Omset Kotor</span>
                        <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                          <BarChart2 className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-[13px] sm:text-base md:text-lg lg:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
                        {formatCurrency(statValues.periodRevenue)}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[11px] text-gray-500 font-bold">
                      <span>Total Transaksi:</span>
                      <span className="text-[#0B192C] font-black bg-gray-100 px-2 py-0.5 rounded-full">{statValues.completedCount} Selesai</span>
                    </div>
                  </motion.div>

                  {/* Card 2: Tech Fees */}
                  <motion.div
                    whileHover={{ y: -4 }}
                    className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Fee Teknisi</span>
                        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                          <Users className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-[13px] sm:text-base md:text-lg lg:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
                        {formatCurrency(statValues.periodTechFee)}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[11px] text-gray-500 font-bold">
                      <span>Porsi Tim:</span>
                      <span className="text-amber-600 font-black bg-amber-50 px-2 py-0.5 rounded-full">
                        {statValues.periodRevenue > 0 ? ((statValues.periodTechFee / statValues.periodRevenue) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </motion.div>

                  {/* Card 3: Expenses */}
                  <motion.div
                    whileHover={{ y: -4 }}
                    className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Pengeluaran</span>
                        <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
                          <Archive className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-[13px] sm:text-base md:text-lg lg:text-xl xl:text-2xl font-black text-[#0B192C] tracking-tight">
                        {formatCurrency(statValues.periodExpense)}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[11px] text-gray-500 font-bold">
                      <span>Biaya Operasional:</span>
                      <span className="text-red-700 font-black bg-red-50 px-2 py-0.5 rounded-full">
                        {statValues.periodRevenue > 0 ? ((statValues.periodExpense / statValues.periodRevenue) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </motion.div>

                  {/* Card 4: Net Profit */}
                  <motion.div
                    whileHover={{ y: -4 }}
                    className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Laba Bersih</span>
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                          <CheckCircle className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-[13px] sm:text-base md:text-lg lg:text-xl xl:text-2xl font-black text-emerald-600 tracking-tight">
                        {formatCurrency(statValues.periodNetProfit)}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[11px] text-gray-500 font-bold">
                      <span>Margin Keuntungan:</span>
                      <span className={`font-black px-2 py-0.5 rounded-full ${statValues.periodNetProfit >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}`}>
                        {statValues.profitMarginRatio.toFixed(1)}%
                      </span>
                    </div>
                  </motion.div>
                </div>

                {/* Main Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Trend Chart (Spans 2 cols on Large screens) */}
                  <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                      <h3 className="font-bold text-[#0B192C] text-lg">
                        Tren Keuangan ({statsPeriod === "custom" ? "Pilihan" : statsPeriod === "7_days" ? "7 Hari" : statsPeriod === "35_days" ? "35 Hari" : "Periode Terpilih"})
                      </h3>
                      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-gray-500">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#0B192C] rounded-sm"></span> Omset</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#F59E0B] rounded-sm"></span> Fee Teknisi</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#EF4444] rounded-sm"></span> Pengeluaran</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#2ECC71] rounded-sm"></span> Laba Bersih</span>
                      </div>
                    </div>
                    
                    {isOwner ? (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={statValues.revenueData}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#F1F3F5"
                            />
                            <XAxis
                              dataKey="label"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 9, fill: "#8A94A6" }}
                            />
                            <YAxis
                              tickFormatter={(val) => `Rp${val / 1000}k`}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 9, fill: "#8A94A6" }}
                            />
                            <RechartsTooltip
                              formatter={(val: number) => formatCurrency(val)}
                              cursor={{ fill: "#f4f6f8" }}
                              contentStyle={{ borderRadius: "16px", borderColor: "#f1f3f5", fontSize: "11px" }}
                            />
                            <Bar
                              dataKey="revenue"
                              fill="#0B192C"
                              radius={[4, 4, 0, 0]}
                              name="Omset"
                            />
                            <Bar
                              dataKey="techFee"
                              fill="#F59E0B"
                              radius={[4, 4, 0, 0]}
                              name="Fee Teknisi"
                            />
                            <Bar
                              dataKey="expense"
                              fill="#EF4444"
                              radius={[4, 4, 0, 0]}
                              name="Pengeluaran Admin"
                            />
                            <Bar
                              dataKey="netProfit"
                              fill="#2ECC71"
                              radius={[4, 4, 0, 0]}
                              name="Laba Bersih"
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-80 flex items-center justify-center text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                        <div className="text-center p-6 bg-white rounded-3xl shadow-sm max-w-sm">
                          <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
                          <p className="text-sm font-bold text-gray-500">Grafik Keuangan hanya tersedia untuk Owner</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Services Breakdown */}
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-[#0B192C] text-lg mb-1">
                        Layanan Terpopuler
                      </h3>
                      <p className="text-[11px] text-gray-400 font-bold mb-4">Urutan pembelian berdasarkan volume kuantitas.</p>
                      
                      <div className="h-44 flex items-center justify-center mb-6">
                        {statValues.servicePieData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={statValues.servicePieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={45}
                                outerRadius={70}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                {statValues.servicePieData.map((entry, index) => (
                                  <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                  />
                                ))}
                              </Pie>
                              <RechartsTooltip contentStyle={{ borderRadius: "12px", fontSize: "11px" }} />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-sm font-bold text-gray-400">
                            Belum ada data layanan
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress representation list for services */}
                    <div className="space-y-3 pr-1 font-sans">
                      {statValues.topServices.slice(0, 4).map((srv, idx) => {
                        const totalUnits = statValues.topServices.reduce((acc, c) => acc + c.value, 0);
                        const pct = totalUnits > 0 ? (srv.value / totalUnits) * 100 : 0;
                        return (
                          <div key={srv.name} className="flex flex-col">
                            <div className="flex justify-between items-center text-[11px] font-bold text-gray-700 mb-1 gap-2">
                              <span className="truncate min-w-0 pr-1" title={srv.name}>{srv.name}</span>
                              <span className="text-[10px] text-gray-400 shrink-0">{srv.value} Unit ({pct.toFixed(0)}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  backgroundColor: COLORS[idx % COLORS.length],
                                  width: `${pct}%`,
                                }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Technician Rankings & Top Service Areas Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left: Technician Productivity Rank */}
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-[#0B192C] text-lg">Productivity & Kinerja Teknisi</h3>
                          <p className="text-[11px] text-gray-400 mt-0.5 font-medium">Peringkat produktivitas berdasarkan jumlah penyelesaian kerja.</p>
                        </div>
                        <div className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black">
                          {statValues.techRanked.length} Teknisi Aktif
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] uppercase font-black tracking-wider text-gray-400">
                              <th className="px-4 py-3">Peringkat</th>
                              <th className="px-4 py-3">Nama Teknisi</th>
                              <th className="px-4 py-3 text-center">Kerja Selesai</th>
                              {isOwner && <th className="px-4 py-3 text-right">Fee Dihasilkan</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {statValues.techRanked.length === 0 ? (
                              <tr>
                                <td colSpan={isOwner ? 4 : 3} className="px-4 py-8 text-center text-gray-400 italic">
                                  Belum ada pengerjaan selesai di periode ini.
                                </td>
                              </tr>
                            ) : (
                              statValues.techRanked.map((tech, idx) => {
                                const isTop1 = idx === 0;
                                const isTop2 = idx === 1;
                                const isTop3 = idx === 2;

                                return (
                                  <tr key={tech.name} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-3.5">
                                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black ${
                                        isTop1 ? "bg-amber-100 text-amber-800 ring-2 ring-amber-400/20" :
                                        isTop2 ? "bg-slate-100 text-slate-800" :
                                        isTop3 ? "bg-amber-50 text-amber-700" :
                                        "bg-gray-100 text-gray-500"
                                      }`}>
                                        {idx + 1}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3.5 font-bold text-[#0B192C]">
                                      {tech.name}
                                    </td>
                                    <td className="px-4 py-3.5 text-center font-bold">
                                      <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full text-[10px] font-black">
                                        {tech.completedCount} Job selesai
                                      </span>
                                    </td>
                                    {isOwner && (
                                      <td className="px-4 py-3.5 text-right font-medium text-green-600">
                                        {formatCurrency(tech.feeEarned)}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Right: Area Terpopuler (Best Locations) */}
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-[#0B192C] text-lg">Area Terpopuler (Wilayah Kerja)</h3>
                        <p className="text-[11px] text-gray-400 mt-0.5 font-medium">Analisis lokasi pelanggan yang paling banyak melakukan order.</p>
                      </div>
                      <div className="px-3 py-1 bg-amber-50 text-amber-600 rounded-xl text-[10px] font-black flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Area Aktif
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[295px] overflow-y-auto pr-2">
                      {statValues.topAreas.length === 0 ? (
                        <p className="text-center text-gray-400 text-xs italic py-12">Belum ada wilayah terekam di periode ini.</p>
                      ) : (
                        statValues.topAreas.map((area, i) => {
                          const maxCount = Math.max(...statValues.topAreas.map(a => a.value), 1);
                          const pct = (area.value / maxCount) * 100;
                          return (
                            <div key={area.name || "None"} className="p-3 bg-[#F4F6F8]/40 hover:bg-[#F4F6F8]/75 rounded-2xl border border-gray-100 transition-colors">
                              <div className="flex justify-between items-center text-xs font-bold text-gray-700 mb-2">
                                <span className="flex items-center gap-1.5 text-[#0B192C]">
                                  <span className="w-2.5 h-2.5 rounded-full bg-[#FFA800]"></span>
                                  {area.name || "Umum"}
                                </span>
                                <span className="text-[10px] text-gray-400 font-bold">{area.value} order</span>
                              </div>
                              <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${pct}%` }}
                                  transition={{ duration: 0.6, delay: i * 0.1 }}
                                  className="bg-gradient-to-r from-[#0B192C] to-[#FFA800] h-full rounded-full"
                                ></motion.div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "customers" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-[#0B192C]">
                    Database Pelanggan
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#F4F6F8]/50 text-gray-500 text-sm font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Nama Pelanggan</th>
                        <th className="px-6 py-4">No. HP</th>
                        <th className="px-6 py-4">Alamat Terakhir</th>
                        <th className="px-6 py-4 text-center">Terakhir Cuci</th>
                        <th className="px-6 py-4 text-center">Total Order</th>
                        <th className="px-6 py-4 text-right">Total Belanja</th>
                        <th className="px-6 py-4 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {parsedCustomers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-6 py-12 text-center text-gray-400"
                          >
                            Belum ada pelanggan.
                          </td>
                        </tr>
                      ) : (
                        parsedCustomers.map((cust, i) => (
                          <motion.tr
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-6 py-4 font-bold text-[#0B192C]">
                              {cust.name}
                            </td>
                            <td className="px-6 py-4 text-gray-600">
                              <div className="flex items-center gap-2">
                                {cust.phone}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600 max-w-xs">
                              {cust.address}
                            </td>
                            <td className="px-6 py-4 text-center text-sm font-medium text-gray-600">
                              {cust.lastServiceDate
                                ? new Date(
                                    cust.lastServiceDate,
                                  ).toLocaleDateString("id-ID", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "-"}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="bg-[#0B192C] text-white px-2.5 py-1 rounded-full text-xs font-bold">
                                {cust.orderCount}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right font-medium text-green-600">
                              {formatCurrency(cust.totalSpent)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => {
                                  const msg = encodeURIComponent(
                                    `Halo Bpk/Ibu ${cust.name}, ini dari JAGO AC. Mengingatkan kembali bahwa AC sudah waktunya dicuci rutin agar tetap dingin dan awet.`,
                                  );
                                  window.open(
                                    `https://wa.me/${cust.phone.replace(/^0/, "62")}?text=${msg}`,
                                    "_blank",
                                  );
                                }}
                                className="bg-[#2ECC71]/10 text-[#2ECC71] hover:bg-[#2ECC71] hover:text-white px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 mx-auto"
                              >
                                <MessageCircle className="w-3 h-3" /> Follow-Up
                              </button>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "inventory" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-[#0B192C]">
                    Stok Barang & Material
                  </h2>
                  <button
                    onClick={() => {
                      setInventoryForm({
                        name: "",
                        stock: "",
                        unit: "",
                        price: "",
                      });
                      setEditingInventory(null);
                      setIsInventoryModalOpen(true);
                    }}
                    className="bg-[#0B192C] text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-black transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Tambah Item
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#F4F6F8]/50 text-gray-500 text-sm font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Nama Item</th>
                        <th className="px-6 py-4 text-center">Sisa Stok</th>
                        <th className="px-6 py-4">Satuan</th>
                        <th className="px-6 py-4 text-right">Harga Beli Pcs</th>
                        <th className="px-6 py-4 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {inventory.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-6 py-12 text-center text-gray-400"
                          >
                            Belum ada item inventaris.
                          </td>
                        </tr>
                      ) : (
                        inventory.map((item, idx) => (
                          <motion.tr
                            key={item.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-6 py-4 font-bold text-[#0B192C]">
                              {item.name}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span
                                className={`px-2.5 py-1 rounded-full text-xs font-bold ${item.stock <= 5 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}
                              >
                                {item.stock}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500">
                              {item.unit}
                            </td>
                            <td className="px-6 py-4 text-right font-medium">
                              {formatCurrency(item.price)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex justify-center gap-2">
                                <button
                                  onClick={() => {
                                    setInventoryForm({
                                      name: item.name,
                                      stock: item.stock.toString(),
                                      unit: item.unit,
                                      price: item.price.toString(),
                                    });
                                    setEditingInventory(item);
                                    setIsInventoryModalOpen(true);
                                  }}
                                  className="text-gray-400 hover:text-[#0B192C] transition-colors"
                                >
                                  <FileText className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => deleteInventoryItem(item.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "orders" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-[#0B192C]">
                      Daftar Order
                    </h2>
                    <button
                      onClick={() => setIsAddingOrder(true)}
                      className="bg-[#0B192C] text-[#FFA800] px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-sm"
                    >
                      <Plus className="w-4 h-4" /> Input Manual
                    </button>
                  </div>
                  <div className="flex items-center w-full sm:w-auto gap-3">
                    <div className="relative flex-1 sm:w-72">
                      <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Cari ID, Nama, No. HP..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[#F4F6F8] pl-12 pr-4 py-3 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[#0B192C]/20"
                      />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleExportOrders("csv")}
                        title="Download CSV"
                        className="bg-white border border-gray-200 text-[#0B192C] px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1 hover:bg-gray-50 transition"
                      >
                        <Download className="w-4 h-4" /> CSV
                      </button>
                      <button
                        onClick={() => handleExportOrders("excel")}
                        title="Download Excel"
                        className="bg-[#107C41] text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1 hover:bg-[#185c37] transition"
                      >
                        <Download className="w-4 h-4" /> Excel
                      </button>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#F4F6F8]/50 text-gray-500 text-sm font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Kode Order</th>
                        <th className="px-6 py-4">Customer</th>
                        <th className="px-6 py-4">Tanggal Masuk</th>
                        <th className="px-6 py-4">Total</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredOrders.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-6 py-12 text-center text-gray-400"
                          >
                            Tidak ada data order ditemukan.
                          </td>
                        </tr>
                      ) : (
                        filteredOrders.map((order, idx) => (
                          <motion.tr
                            key={order.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-6 py-4 font-mono font-bold text-gray-600 text-sm">
                              {order.id}
                            </td>
                            <td className="px-6 py-4">
                              <p className="font-bold text-[#0B192C]">
                                {order.customerName}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-xs text-gray-500">
                                  {order.phone}
                                </p>
                                <a
                                  href={getWhatsAppLink(
                                    order.phone,
                                    order.customerName,
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-600 hover:text-green-700 bg-green-50 p-1 rounded-full transition-colors"
                                  title="Chat via WhatsApp"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {safeFormatDate(order.createdAt)}
                              <br />
                              <span className="text-xs opacity-70">
                                {safeFormatTime(order.createdAt)}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-bold text-[#0B192C]">
                              {formatCurrency(calculateFinalTotal(order))}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 ${
                                  order.status === "Selesai"
                                    ? "bg-green-100 text-green-700"
                                    : order.status === "Sedang Dikerjakan"
                                      ? "bg-orange-100 text-orange-700"
                                      : order.status === "Teknisi Ditugaskan"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-gray-100 text-gray-700"
                                }`}
                              >
                                {(order.status === "Menunggu Konfirmasi" ||
                                  order.status === "Pending") && (
                                  <Clock className="w-3 h-3" />
                                )}
                                {order.status === "Teknisi Ditugaskan" && (
                                  <Users className="w-3 h-3" />
                                )}
                                {order.status === "Sedang Dikerjakan" && (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                )}
                                {order.status === "Selesai" && (
                                  <CheckCircle className="w-3 h-3" />
                                )}
                                {order.status === "Pending"
                                  ? "Menunggu Konfirmasi"
                                  : order.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => setSelectedOrder(order)}
                                  className="bg-[#0B192C] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#FFA800] hover:text-[#0B192C] transition-colors shadow-sm"
                                >
                                  Detail
                                </button>
                                <button
                                  onClick={() => deleteOrder(order.id)}
                                  className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-3 py-2 rounded-lg transition-colors shadow-sm inline-flex items-center justify-center"
                                  title="Hapus Pesanan"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "vouchers" && (
              <div className="space-y-6">
                <div className="bg-[#0B192C] p-8 rounded-[40px] text-white shadow-xl shadow-blue-200/20 relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                          <FileText className="w-6 h-6 text-[#FFA800]" />
                        </div>
                        <h2 className="text-2xl font-black">
                          Manajemen Voucher{" "}
                          {voucherTabMode === "calendar"
                            ? "& Jadwal Promo"
                            : ""}
                        </h2>
                      </div>
                      <p className="text-blue-100 opacity-80 text-sm max-w-md font-medium leading-relaxed">
                        Kelola kode promo Anda, atur masa berlaku di kalender,
                        dan dapatkan rekomendasi tanggal strategis untuk
                        meledakkan penjualan jasa AC Anda.
                      </p>
                    </div>
                    <div className="flex bg-white/10 p-1.5 rounded-2xl">
                      <button
                        onClick={() => setVoucherTabMode("table")}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${voucherTabMode === "table" ? "bg-[#FFA800] text-[#0B192C]" : "text-white hover:bg-white/10"}`}
                      >
                        <FileText className="w-4 h-4" /> Tabel Voucher
                      </button>
                      <button
                        onClick={() => setVoucherTabMode("calendar")}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${voucherTabMode === "calendar" ? "bg-[#FFA800] text-[#0B192C]" : "text-white hover:bg-white/10"}`}
                      >
                        <Calendar className="w-4 h-4" /> Jadwal Promo
                      </button>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-16 translate-x-16 blur-2xl"></div>
                </div>

                {voucherTabMode === "calendar" && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Recommendation Panel */}
                    <div className="lg:col-span-4 space-y-6">
                      <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                          <div className="w-10 h-10 bg-[#EBFAEF] text-[#25D366] rounded-2xl flex items-center justify-center">
                            <Sparkles className="w-6 h-6" />
                          </div>
                          <h3 className="font-black text-[#0B192C] text-base uppercase tracking-tight">
                            AI Rekomendasi Promo
                          </h3>
                        </div>

                        <div className="space-y-4">
                          {INDONESIA_HOLIDAYS.filter((h) => {
                            const hDate = new Date(h.date);
                            return (
                              hDate.getMonth() ===
                                currentCalendarMonth.getMonth() &&
                              hDate.getFullYear() ===
                                currentCalendarMonth.getFullYear()
                            );
                          }).map((h, i) => (
                            <div
                              key={i}
                              className="p-4 rounded-2xl bg-[#F4F6F8] border border-gray-100 hover:border-[#FFA800]/30 transition-all group"
                            >
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                                  {h.name}
                                </span>
                                <span className="text-[10px] font-black text-gray-400">
                                  {new Date(h.date).toLocaleDateString(
                                    "id-ID",
                                    { day: "numeric", month: "short" },
                                  )}
                                </span>
                              </div>
                              <h4 className="font-bold text-[#0B192C] text-sm mb-2">
                                Promo "Flash Sale {h.name.split(" ")[0]}"
                              </h4>
                              <p className="text-[11px] text-gray-500 leading-relaxed italic">
                                "Saran: Berikan voucher diskon Rp25.000 selama{" "}
                                {h.name} untuk meningkatkan order jasa cuci AC
                                2x lipat."
                              </p>
                              <button
                                onClick={() => {
                                  setPromoForm({
                                    ...promoForm,
                                    id: `PROMO${h.name.substring(0, 3).toUpperCase()}`,
                                    startDate: h.date,
                                    endDate: h.date,
                                    discount: "25000",
                                    minTransaction: "",
                                  });
                                  setIsPromoModalOpen(true);
                                }}
                                className="mt-3 w-full py-2 bg-white text-[#0B192C] border border-gray-200 rounded-xl text-[10px] font-black uppercase hover:bg-[#0B192C] hover:text-white transition-all shadow-sm"
                              >
                                Terapkan Strategi Ini
                              </button>
                            </div>
                          ))}
                          {INDONESIA_HOLIDAYS.filter((h) => {
                            const hDate = new Date(h.date);
                            return (
                              hDate.getMonth() ===
                                currentCalendarMonth.getMonth() &&
                              hDate.getFullYear() ===
                                currentCalendarMonth.getFullYear()
                            );
                          }).length === 0 && (
                            <div className="p-8 text-center bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                              <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                              <p className="text-xs text-gray-400 font-bold italic">
                                Tidak ada hari libur besar di bulan ini untuk
                                rekomendasi khusus.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Calendar Panel */}
                    <div className="lg:col-span-8">
                      <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#F4F6F8]/50">
                          <div className="flex items-center gap-4">
                            <div className="bg-white border border-gray-200 rounded-xl flex items-center px-2 py-1">
                              <button
                                onClick={() => handleMonthNav(-1)}
                                className="p-2 hover:bg-gray-100 rounded-lg"
                              >
                                <ChevronLeft className="w-5 h-5" />
                              </button>
                              <span className="px-4 font-bold text-sm min-w-[140px] text-center uppercase tracking-wider">
                                {
                                  indonesianMonths[
                                    currentCalendarMonth.getMonth()
                                  ]
                                }{" "}
                                {currentCalendarMonth.getFullYear()}
                              </span>
                              <button
                                onClick={() => handleMonthNav(1)}
                                className="p-2 hover:bg-gray-100 rounded-lg"
                              >
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 rounded-lg border border-red-100">
                              <div className="w-2 h-2 rounded-full bg-red-500"></div>
                              <span className="text-[9px] font-black text-red-600 uppercase">
                                Hari Libur
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-100">
                              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                              <span className="text-[9px] font-black text-blue-600 uppercase">
                                Voucher Aktif
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="p-6">
                          <div className="grid grid-cols-7 mb-4">
                            {indonesianDays.map((day) => (
                              <div
                                key={day}
                                className="text-center text-xs font-black text-gray-400 uppercase"
                              >
                                {day}
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-2">
                            {getCalendarDays().map((day, idx) => {
                              const dateStr = day
                                ? `${currentCalendarMonth.getFullYear()}-${String(currentCalendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                                : "";
                              const holiday = day
                                ? INDONESIA_HOLIDAYS.find(
                                    (h) => h.date === dateStr,
                                  )
                                : null;
                              const activePromos = day
                                ? promos.filter((p) => {
                                    if (!p.isActive) return false;
                                    if (p.startDate && p.endDate) {
                                      return (
                                        dateStr >= p.startDate &&
                                        dateStr <= p.endDate
                                      );
                                    }
                                    return false;
                                  })
                                : [];

                              return (
                                <div
                                  key={idx}
                                  className={`min-h-[100px] border border-gray-100 rounded-3xl p-3 relative group transition-all ${day === null ? "bg-gray-50/30" : holiday ? "bg-red-50/30 border-red-100" : "bg-white hover:border-[#FFA800]/50"}`}
                                >
                                  {day && (
                                    <>
                                      <div className="flex justify-between items-start">
                                        <span
                                          className={`text-sm font-black ${holiday ? "text-red-500" : "text-gray-400"}`}
                                        >
                                          {day}
                                        </span>
                                        {holiday && (
                                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                                        )}
                                      </div>

                                      <div className="mt-2 space-y-1">
                                        {holiday && (
                                          <p className="text-[8px] font-black text-red-500/70 uppercase leading-tight line-clamp-2">
                                            {holiday.name}
                                          </p>
                                        )}
                                        {activePromos.map((p) => (
                                          <button
                                            key={p.id}
                                            onClick={() => {
                                              setEditingPromo(p);
                                              setPromoForm({
                                                id: p.id,
                                                discount: p.discount.toString(),
                                                isActive: p.isActive,
                                                maxUsageTotal:
                                                  p.maxUsageTotal.toString(),
                                                maxUsagePerDay:
                                                  p.maxUsagePerDay.toString(),
                                                requirement:
                                                  p.requirement || "",
                                                description:
                                                  p.description || "",
                                                startDate: p.startDate || "",
                                                endDate: p.endDate || "",
                                                minTransaction: (p.minTransaction || "").toString(),
                                              });
                                              setIsPromoModalOpen(true);
                                            }}
                                            className="w-full text-left bg-blue-500 text-white text-[9px] font-black px-2 py-1 rounded-lg truncate hover:brightness-110 transition-all border-b-2 border-blue-700 shadow-sm"
                                          >
                                            {p.id}
                                          </button>
                                        ))}
                                        {day && (
                                          <button
                                            onClick={() => {
                                              setPromoForm({
                                                ...promoForm,
                                                id: "",
                                                startDate: dateStr,
                                                endDate: dateStr,
                                              });
                                              setEditingPromo(null);
                                              setIsPromoModalOpen(true);
                                            }}
                                            className="w-full mt-1 border border-dashed border-gray-200 rounded-lg py-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                          >
                                            <Plus className="w-3 h-3 text-gray-400" />
                                          </button>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {voucherTabMode === "table" && (
                  <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-8 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-6">
                      <div className="space-y-1">
                        <h2 className="text-xl font-black text-[#0B192C]">
                          Daftar Voucher Tersimpan
                        </h2>
                        <p className="text-xs text-gray-400 font-bold">
                          Kelola parameter diskon dan kuota penggunaan per kode
                          voucher.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleExportVouchers("csv")}
                          title="Download CSV"
                          className="bg-white border border-gray-200 text-[#0B192C] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center hover:bg-gray-50 transition shadow-sm active:scale-95"
                        >
                          <Download className="w-4 h-4 mr-2" /> CSV
                        </button>
                        <button
                          onClick={() => handleExportVouchers("excel")}
                          title="Download Excel"
                          className="bg-[#107C41] text-white px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center hover:bg-[#185c37] transition shadow-sm active:scale-95"
                        >
                          <Download className="w-4 h-4 mr-2" /> EXCEL
                        </button>
                        <button
                          onClick={() => {
                            setPromoForm({
                              id: "",
                              discount: "",
                              isActive: true,
                              maxUsageTotal: "",
                              maxUsagePerDay: "",
                              requirement: "",
                              description: "",
                              startDate: "",
                              endDate: "",
                              minTransaction: "",
                            });
                            setEditingPromo(null);
                            setIsPromoModalOpen(true);
                          }}
                          className="bg-[#0B192C] text-[#FFA800] px-6 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 hover:brightness-110 transition shadow-lg shadow-blue-900/10 active:scale-95"
                        >
                          <Plus className="w-5 h-5" /> BUAT VOUCHER BARU
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-[#F4F6F8]/50 text-gray-500 text-[10px] font-black uppercase tracking-widest">
                          <tr>
                            <th className="px-8 py-5">Kode Voucher</th>
                            <th className="px-8 py-5">Potongan</th>
                            <th className="px-8 py-5">Masa Berlaku</th>
                            <th className="px-8 py-5">
                              Sisa Kuota Harian / Total
                            </th>
                            <th className="px-8 py-5">Status</th>
                            <th className="px-8 py-5 text-center">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {promos.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-8 py-20 text-center text-gray-400 italic"
                              >
                                Belum ada promo terdaftar. Klik tombol di atas
                                untuk membuat.
                              </td>
                            </tr>
                          ) : (
                            promos.map((promo, idx) => {
                              const todayStr = new Date().toLocaleDateString(
                                "en-CA",
                              );
                              const currentDayUsage =
                                promo.lastUsedDate === todayStr
                                  ? promo.usedToday || 0
                                  : 0;
                              return (
                                <motion.tr
                                  key={promo.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="hover:bg-gray-50/80 transition-colors group"
                                >
                                  <td className="px-8 py-6">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-[#F4F6F8] text-[#0B192C] rounded-2xl flex items-center justify-center font-black text-sm">
                                        {promo.id.charAt(0)}
                                      </div>
                                      <span className="font-black text-[#0B192C] text-base tracking-tight">
                                        {promo.id}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-8 py-6 font-black text-[#FFA800] text-base">
                                    {formatCurrency(promo.discount)}
                                  </td>
                                  <td className="px-8 py-6">
                                    {promo.startDate && promo.endDate ? (
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-bold text-[#0B192C]">
                                          {new Date(
                                            promo.startDate,
                                          ).toLocaleDateString("id-ID", {
                                            day: "numeric",
                                            month: "short",
                                          })}{" "}
                                          -{" "}
                                          {new Date(
                                            promo.endDate,
                                          ).toLocaleDateString("id-ID", {
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                          })}
                                        </span>
                                        <span className="text-[9px] text-gray-400 font-black uppercase tracking-tighter">
                                          Event Terjangkau
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-xs font-bold text-gray-400 uppercase italic">
                                        Tanpa Batas Waktu
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-8 py-6">
                                    <div className="flex flex-col gap-1.5">
                                      <div className="flex justify-between items-center w-32">
                                        <span className="text-[10px] font-black text-gray-400">
                                          Total:
                                        </span>
                                        <span className="text-xs font-black text-[#0B192C]">
                                          {promo.usedTotal || 0} /{" "}
                                          {promo.maxUsageTotal > 0
                                            ? promo.maxUsageTotal
                                            : "∞"}
                                        </span>
                                      </div>
                                      <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-blue-500 rounded-full"
                                          style={{
                                            width:
                                              promo.maxUsageTotal > 0
                                                ? `${Math.min(100, ((promo.usedTotal || 0) / promo.maxUsageTotal) * 100)}%`
                                                : "10%",
                                          }}
                                        ></div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-8 py-6">
                                    <span
                                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest ${promo.isActive ? "bg-[#EBFAEF] text-[#25D366] border border-[#25D366]/20" : "bg-red-50 text-red-500 border border-red-100"}`}
                                    >
                                      {promo.isActive ? "AKTIF" : "OFF"}
                                    </span>
                                  </td>
                                  <td className="px-8 py-6 text-center">
                                    <div className="flex justify-center gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingPromo(promo);
                                          setPromoForm({
                                            id: promo.id,
                                            discount: promo.discount.toString(),
                                            isActive: promo.isActive,
                                            maxUsageTotal:
                                              promo.maxUsageTotal.toString(),
                                            maxUsagePerDay:
                                              promo.maxUsagePerDay.toString(),
                                            requirement:
                                              promo.requirement || "",
                                            description:
                                              promo.description || "",
                                            startDate: promo.startDate || "",
                                            endDate: promo.endDate || "",
                                            minTransaction: (promo.minTransaction || "").toString(),
                                          });
                                          setIsPromoModalOpen(true);
                                        }}
                                        className="p-2.5 bg-[#F4F6F8] text-gray-400 hover:text-[#0B192C] hover:bg-[#EBFAEF] rounded-xl transition-all"
                                      >
                                        <FileText className="w-5 h-5" />
                                      </button>
                                    </div>
                                  </td>
                                </motion.tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === "technicians" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#F4F6F8]/50">
                  <h2 className="text-xl font-bold text-[#0B192C]">
                    Tim Teknisi
                  </h2>
                </div>
                <div className="p-6 border-b border-gray-100 bg-white">
                  <form
                    onSubmit={saveTechnician}
                    className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
                  >
                    <div className="w-full">
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Nama Teknisi
                      </label>
                      <input
                        type="text"
                        value={newTechName}
                        onChange={(e) => setNewTechName(e.target.value)}
                        placeholder="Contoh: Budi"
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div className="w-full">
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        No. HP / WA
                      </label>
                      <input
                        type="text"
                        value={newTechPhone}
                        onChange={(e) => setNewTechPhone(e.target.value)}
                        placeholder="Contoh: 0812..."
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div className="w-full">
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Lokasi
                      </label>
                      <select
                        value={newTechLocation}
                        onChange={(e) => setNewTechLocation(e.target.value)}
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      >
                        <option value="">Pilih Lokasi</option>
                        <option value="Makassar">Makassar</option>
                        <option value="Gowa">Gowa</option>
                        <option value="Maros">Maros</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-[#0B192C] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#1A283C] transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus className="w-5 h-5" /> Tambah
                    </button>
                  </form>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#F4F6F8]/50 text-gray-500 text-sm font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Nama</th>
                        <th className="px-6 py-4">No. HP</th>
                        <th className="px-6 py-4">Lokasi</th>
                        <th className="px-6 py-4 text-center">
                          Pesanan Selesai
                        </th>
                        <th className="px-6 py-4 text-right">
                          Total Hak Teknisi
                        </th>
                        <th className="px-6 py-4 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {technicians.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-6 py-8 text-center text-gray-400"
                          >
                            Belum ada data teknisi.
                          </td>
                        </tr>
                      ) : (
                        technicians.map((t, idx) => {
                          const techOrders = orders.filter(
                            (o) =>
                              o.technician === t.name && o.status === "Selesai",
                          );
                          const totalEarned = techOrders.reduce(
                            (sum, o) => sum + calculateOrderSplit(o).techCut,
                            0,
                          );
                          return (
                            <motion.tr
                              key={t.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              className="hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-6 py-4 font-bold text-[#0B192C]">
                                {t.name}
                              </td>
                              <td className="px-6 py-4 text-gray-600">
                                {t.phone}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500 font-medium">
                                <span className="flex items-center gap-1.5 drop-shadow-sm">
                                  <MapPin className="w-3.5 h-3.5 text-red-500" />
                                  {t.location || "-"}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center font-bold text-[#0B192C]">
                                {techOrders.length}
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-green-600">
                                {formatCurrency(totalEarned)}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={() => deleteTechnician(t.id)}
                                  className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </motion.tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "expenses" && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#F4F6F8]/50">
                  <h2 className="text-xl font-bold text-[#0B192C]">
                    Buku Pengeluaran
                  </h2>
                </div>
                <div className="p-6 border-b border-gray-100 bg-white">
                  <form
                    onSubmit={saveExpense}
                    className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
                  >
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Tanggal
                      </label>
                      <input
                        type="date"
                        value={newExpDate}
                        onChange={(e) => setNewExpDate(e.target.value)}
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Keterangan Pengeluaran
                      </label>
                      <input
                        type="text"
                        value={newExpDesc}
                        onChange={(e) => setNewExpDesc(e.target.value)}
                        placeholder="Beli Freon R32, Bensin, dll"
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Jumlah (Rp)
                      </label>
                      <input
                        type="number"
                        value={newExpAmount}
                        onChange={(e) => setNewExpAmount(e.target.value)}
                        placeholder="50000"
                        min="0"
                        className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-[#FFA800] focus:border-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div className="sm:col-span-4 flex justify-end">
                      <button
                        type="submit"
                        className="w-full sm:w-auto bg-[#0B192C] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#1A283C] transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" /> Catat Kas Keluar
                      </button>
                    </div>
                  </form>
                </div>
                <div className="p-6 bg-red-50 border-b border-red-100 flex justify-between items-center">
                  <div>
                    <div className="text-red-700 text-sm font-bold uppercase tracking-wider mb-1">
                      Total Pengeluaran
                    </div>
                    <div className="text-3xl font-black text-red-600">
                      {formatCurrency(
                        expenses.reduce((sum, exp) => sum + exp.amount, 0),
                      )}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-[#F4F6F8]/50 text-gray-500 text-sm font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Tanggal</th>
                        <th className="px-6 py-4">Keterangan</th>
                        <th className="px-6 py-4 text-right">Jumlah</th>
                        <th className="px-6 py-4 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {expenses.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-6 py-8 text-center text-gray-400"
                          >
                            Belum ada pengeluaran dicatat.
                          </td>
                        </tr>
                      ) : (
                        expenses.map((exp, idx) => (
                          <motion.tr
                            key={exp.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-6 py-4 text-gray-600">
                              {new Date(exp.date).toLocaleDateString("id-ID", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td className="px-6 py-4 font-bold text-[#0B192C]">
                              {exp.description}
                            </td>
                            <td className="px-6 py-4 text-right font-medium text-red-600">
                              {formatCurrency(exp.amount)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => deleteExpense(exp.id)}
                                className="text-gray-400 hover:text-red-500 p-2 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "followup" && (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#F4F6F8]/50">
                    <div>
                      <h2 className="text-xl font-bold text-[#0B192C] flex items-center gap-2">
                        <MessageCircle className="w-6 h-6 text-purple-600" /> Follow-up 4 Hari Pasca Cuci
                      </h2>
                      <p className="text-xs text-gray-500 mt-1">
                        Pelanggan yang AC-nya selesai dicuci 4-7 hari yang lalu. Pastikan kualitas terjaga!
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[10px] uppercase font-black text-gray-400 tracking-widest">
                        <tr>
                          <th className="px-6 py-4">Tgl Selesai</th>
                          <th className="px-6 py-4">Selang Waktu</th>
                          <th className="px-6 py-4">Pelanggan</th>
                          <th className="px-6 py-4">Layanan</th>
                          <th className="px-6 py-4 text-center">Aksi Follow-up</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {orders
                          .filter((order) => {
                            if (order.status !== "Selesai") return false;
                            const compDate = new Date(order.date);
                            const now = new Date();
                            const diff = Math.ceil(Math.abs(now.getTime() - compDate.getTime()) / (1000 * 60 * 60 * 24));
                            return diff >= 4 && diff <= 7;
                          })
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((order, idx) => {
                            const compDate = new Date(order.date);
                            const now = new Date();
                            const diff = Math.ceil(Math.abs(now.getTime() - compDate.getTime()) / (1000 * 60 * 60 * 24));
                            const waLink = `https://wa.me/${order.phone.replace(/[^0-9]/g, "").startsWith("0") ? "62" + order.phone.replace(/[^0-9]/g, "").substring(1) : order.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(whatsappTemplates.find(t => t.id === "followup_4days")?.message(order) || "")}`;

                            return (
                              <motion.tr
                                key={order.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="hover:bg-gray-50 transition-colors"
                              >
                                <td className="px-6 py-4 text-xs font-medium text-gray-600">
                                  {safeFormatDate(order.date)}
                                </td>
                                <td className="px-6 py-4">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-50 text-purple-600">
                                    {diff} Hari Lalu
                                  </span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-[#0B192C]">{order.customerName}</span>
                                    <span className="text-[10px] text-gray-500">{order.phone}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-xs text-gray-600 italic">
                                  {order.serviceType}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <a
                                    href={waLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:brightness-110 transition-all shadow-md shadow-green-100"
                                  >
                                    <MessageCircle className="w-3 h-3" /> KIRIM FOLLOW-UP
                                  </a>
                                </td>
                              </motion.tr>
                            );
                          })}
                          {orders.filter(o => {
                            const diff = Math.ceil(Math.abs(new Date().getTime() - new Date(o.date).getTime()) / (1000 * 60 * 60 * 24));
                            return o.status === "Selesai" && diff >= 4 && diff <= 7;
                          }).length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm italic">
                                Tidak ada pelanggan yang perlu di-follow up hari ini.
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "tech_reports" && (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#F4F6F8]/50">
                    <div>
                      <h2 className="text-xl font-bold text-[#0B192C]">
                        Checklist & Laporan Teknisi
                      </h2>
                      <p className="text-xs text-gray-500 mt-1">
                        Pengecekan Unit Indoor & Outdoor oleh teknisi lapangan.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[10px] uppercase font-black text-gray-400 tracking-widest">
                        <tr>
                          <th className="px-6 py-4">Waktu Lapor</th>
                          <th className="px-6 py-4">Teknisi</th>
                          <th className="px-6 py-4">Pelanggan</th>
                          <th className="px-6 py-4">ID Pesanan</th>
                          <th className="px-6 py-4 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {techReports.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-6 py-12 text-center text-gray-400"
                            >
                              Belum ada laporan dari teknisi.
                            </td>
                          </tr>
                        ) : (
                          techReports
                            .filter(
                              (r) =>
                                r.technicianName
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) ||
                                r.customerName
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) ||
                                r.orderId
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()),
                            )
                            .map((report, idx) => (
                              <motion.tr
                                key={report.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="hover:bg-gray-50 transition-colors"
                              >
                                <td className="px-6 py-4 text-xs font-medium text-gray-600">
                                  {new Date(report.timestamp).toLocaleString(
                                    "id-ID",
                                  )}
                                </td>
                                <td className="px-6 py-4 font-bold text-[#0B192C]">
                                  {report.technicianName}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-[#0B192C]">{report.customerName}</span>
                                    <span className="text-[10px] text-gray-500">{orders.find(o => o.id === report.orderId)?.phone || "-"}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                                    {report.orderId}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      onClick={() => setSelectedReport(report)}
                                      className="bg-[#0B192C] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-900 transition-colors"
                                    >
                                      Detail
                                    </button>
                                    <a
                                      href={getReportWhatsAppLink(report)}
                                      target="_blank"
                                      rel="no-referrer"
                                      className="bg-green-600 text-white p-2 rounded-lg hover:brightness-110 transition-all"
                                      title="Kirim ke WhatsApp"
                                    >
                                      <MessageCircle className="w-4 h-4" />
                                    </a>
                                    <button
                                      onClick={() => generateReportPdf(report)}
                                      className="bg-blue-600 text-white p-2 rounded-lg hover:brightness-110 transition-all"
                                      title="Download PDF"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </motion.tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "owner_settings" && isOwner && (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#F4F6F8]/50">
                    <h2 className="text-xl font-bold text-[#0B192C] flex items-center gap-2">
                      <ShieldCheck className="w-6 h-6 text-[#FFA800]" />{" "}
                      Pengaturan Khusus Owner
                    </h2>
                  </div>
                  <div className="p-6 space-y-8">
                    <div>
                      <h3 className="text-lg font-black mb-4">
                        Manajemen Akses Admin
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Email di bawah ini akan mendapatkan akses ke dashboard
                        dengan hak "Admin Biasa".
                      </p>
                      <table className="w-full max-w-lg border border-gray-100 rounded-2xl overflow-hidden">
                        <thead className="bg-[#F4F6F8] text-xs font-bold text-gray-500 uppercase">
                          <tr>
                            <th className="px-4 py-3 text-left">Email Admin</th>
                            <th className="px-4 py-3 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm font-medium">
                          {isAdminList.map((email) => (
                            <tr key={email}>
                              <td className="px-4 py-3">{email}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={async () => {
                                    try {
                                      await deleteDoc(doc(db, "admins", email));
                                      alert(
                                        `Berhasil menghapus admin: ${email}`,
                                      );
                                    } catch (err) {
                                      handleFirestoreError(
                                        err,
                                        OperationType.DELETE,
                                        "admins",
                                      );
                                    }
                                  }}
                                  className="text-red-500 hover:text-red-700 font-bold"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          ))}
                          {isAdminList.length === 0 && (
                            <tr>
                              <td
                                colSpan={2}
                                className="px-4 py-6 text-center text-gray-400"
                              >
                                Belum ada admin tambahan.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const formData = new FormData(e.currentTarget);
                          const email = (
                            (formData.get("email") as string) || ""
                          )
                            .trim()
                            .toLowerCase();
                          if (email) {
                            try {
                              await setDoc(doc(db, "admins", email), {
                                joined: new Date().toISOString(),
                              });
                              e.currentTarget.reset();
                              alert(`Berhasil menambahkan admin: ${email}`);
                            } catch (err) {
                              handleFirestoreError(
                                err,
                                OperationType.WRITE,
                                "admins",
                              );
                            }
                          }
                        }}
                        className="mt-4 flex gap-2 max-w-lg"
                      >
                        <input
                          name="email"
                          type="email"
                          placeholder="contoh@gmail.com"
                          required
                          className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-[#0B192C] outline-none"
                        />
                        <button
                          type="submit"
                          className="bg-[#0B192C] text-white px-4 py-2 rounded-xl text-sm font-bold shadow hover:bg-black transition-colors"
                        >
                          Tambah Admin
                        </button>
                      </form>
                    </div>

                    <div className="border-t border-gray-100 pt-8">
                      <h3 className="text-lg font-black mb-4">
                        Ubah Harga Layanan (Front-End)
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Gunakan ini untuk memperbarui harga layanan di halaman
                        utama. Kosongkan untuk harga default.
                      </p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const formData = new FormData(e.currentTarget);
                          const prices: Record<number, number> = {};
                          [...Array(10)].forEach((_, i) => {
                            const val = formData.get(`price_${i + 1}`);
                            if (val)
                              prices[i + 1] = parseInt(val.toString(), 10);
                          });
                          try {
                            await setDoc(
                              doc(db, "settings", "services"),
                              { prices },
                              { merge: true },
                            );
                            alert("Harga berhasil diupdate!");
                          } catch (err) {
                            console.error(err);
                            alert("Gagal update harga");
                          }
                        }}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {SERVICES_LIST.map((service) => {
                            const sid = service.id;
                            return (
                              <div
                                key={sid}
                                className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex flex-col justify-between"
                              >
                                <label className="block text-xs font-bold text-gray-500 mb-2">
                                  {service.name}
                                </label>
                                <div className="flex bg-white rounded-lg overflow-hidden border border-gray-200 mt-auto">
                                  <div className="bg-gray-100 px-3 py-2 text-xs font-bold text-gray-400 border-r border-gray-200 flex items-center">
                                    Rp
                                  </div>
                                  <input
                                    name={`price_${sid}`}
                                    type="number"
                                    defaultValue={servicePrices[sid] || ""}
                                    placeholder={service.defaultPrice.toLocaleString(
                                      "id-ID",
                                    )}
                                    className="w-full px-3 py-2 text-sm font-bold outline-none text-[#0B192C]"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          type="submit"
                          className="mt-4 bg-green-600 text-white px-6 py-3 rounded-xl font-bold shadow hover:bg-green-700 transition-colors flex items-center gap-2"
                        >
                          <Check className="w-4 h-4" /> Simpan Perubahan Harga
                        </button>
                      </form>
                    </div>

                    <div className="border-t border-gray-100 pt-8">
                      <h3 className="text-lg font-black mb-4">
                        Riwayat Aktivitas Admin (Log)
                      </h3>
                      <div className="overflow-hidden border border-gray-100 rounded-2xl max-h-96 overflow-y-auto">
                        <table className="w-full text-left font-medium text-sm">
                          <thead className="bg-[#F4F6F8] text-xs font-bold text-gray-500 uppercase sticky top-0">
                            <tr>
                              <th className="px-4 py-3">Waktu</th>
                              <th className="px-4 py-3">Admin</th>
                              <th className="px-4 py-3">Aksi</th>
                              <th className="px-4 py-3">Detail</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {auditLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-500 text-xs">
                                  {new Date(log.timestamp).toLocaleString(
                                    "id-ID",
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {log.userEmail?.split("@")[0]}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold">
                                    {log.action}
                                  </span>
                                </td>
                                <td
                                  className="px-4 py-3 text-gray-600 truncate max-w-[200px]"
                                  title={log.details}
                                >
                                  {log.details}
                                </td>
                              </tr>
                            ))}
                            {auditLogs.length === 0 && (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="px-4 py-6 text-center text-gray-400"
                                >
                                  Belum ada riwayat aktivitas.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-8">
                      <h3 className="text-lg font-black mb-4">
                        Leaderboard Teknisi (Top 3)
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {[...technicians]
                          .map((t) => {
                            const techOrders = orders.filter(
                              (o) =>
                                o.technician === t.name &&
                                o.status === "Selesai",
                            );
                            const totalEarned = techOrders.reduce((sum, o) => {
                              const split = calculateOrderSplit(o);
                              return sum + split.techCut;
                            }, 0);
                            return {
                              ...t,
                              orderCount: techOrders.length,
                              totalEarned,
                            };
                          })
                          .sort((a, b) => b.totalEarned - a.totalEarned)
                          .slice(0, 3)
                          .map((t, idx) => (
                            <div
                              key={t.id}
                              className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 relative overflow-hidden"
                            >
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-white shrink-0 ${idx === 0 ? "bg-yellow-400" : idx === 1 ? "bg-gray-300" : "bg-orange-400"}`}
                              >
                                {idx + 1}
                              </div>
                              <div className="min-w-0 z-10">
                                <h4 className="font-bold text-[#0B192C] text-sm truncate">
                                  {t.name}
                                </h4>
                                <p className="text-xs text-gray-500">
                                  {t.orderCount} Pesanan Selesai
                                </p>
                                <p className="text-xs font-black text-green-600 mt-0.5">
                                  {formatCurrency(t.totalEarned)}
                                </p>
                              </div>
                              {idx === 0 && (
                                <Star className="w-16 h-16 text-yellow-50 absolute -right-3 -bottom-3 z-0 pointer-events-none" />
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "laporan" && isOwner && (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden text-[#0B192C]">
                <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#F4F6F8]/50">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <BookOpen className="w-5 h-5" /> Tutup Buku & Laporan
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Unduh rekapitulasi untung-rugi berdasarkan periode
                    </p>
                  </div>
                  <div className="flex gap-2 w-full md:w-auto">
                    <button
                      onClick={handleDownloadFullSummaryExcel}
                      className="flex-1 md:flex-none justify-center bg-[#107C41] text-white px-4 py-2 rounded-xl font-bold hover:bg-green-800 transition-colors flex items-center gap-2"
                      title="Download Rangkuman Seluruh Database (Excel)"
                    >
                      <Download className="w-4 h-4" /> REKAP SEMUA (XL)
                    </button>
                    <button
                      onClick={handleDownloadFullSummaryPDF}
                      className="flex-1 md:flex-none justify-center bg-[#E74C3C] text-white px-4 py-2 rounded-xl font-bold hover:bg-red-800 transition-colors flex items-center gap-2"
                      title="Download Rangkuman Seluruh Database (PDF)"
                    >
                      <Download className="w-4 h-4" /> REKAP SEMUA (PDF)
                    </button>
                    <div className="w-px h-10 bg-gray-200 hidden md:block mx-1"></div>
                    <button
                      onClick={handleDownloadReportExcel}
                      className="flex-1 md:flex-none justify-center bg-green-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-700 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" /> Excel (Periode)
                    </button>
                    <button
                      onClick={handleDownloadReportPdf}
                      className="flex-1 md:flex-none justify-center bg-red-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-700 transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" /> PDF (Periode)
                    </button>
                  </div>
                </div>

                <div className="p-6 border-b border-gray-100">
                  <div className="flex flex-col sm:flex-row gap-4 items-end mb-6">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Mulai Tanggal
                      </label>
                      <input
                        type="date"
                        value={reportStartDate}
                        onChange={(e) => setReportStartDate(e.target.value)}
                        className="border border-gray-200 p-2.5 rounded-xl font-bold text-sm focus:ring-2 focus:ring-[#FFA800] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">
                        Sampai Tanggal
                      </label>
                      <input
                        type="date"
                        value={reportEndDate}
                        onChange={(e) => setReportEndDate(e.target.value)}
                        className="border border-gray-200 p-2.5 rounded-xl font-bold text-sm focus:ring-2 focus:ring-[#FFA800] outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                        Total Omset
                      </div>
                      <div className="text-xl font-black text-[#0B192C]">
                        {formatCurrency(reportMetrics.totalRevenue)}
                      </div>
                    </div>
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                      <div className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-1">
                        Fee Teknisi
                      </div>
                      <div className="text-xl font-black text-orange-700">
                        {formatCurrency(reportMetrics.totalTechFee)}
                      </div>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
                      <div className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">
                        Keluar Admin
                      </div>
                      <div className="text-xl font-black text-red-700">
                        {formatCurrency(reportMetrics.totalExpense)}
                      </div>
                    </div>
                    <div className="bg-green-50 border border-green-100 rounded-2xl p-4 md:row-span-1">
                      <div className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">
                        Laba Bersih Jago AC
                      </div>
                      <div className="text-2xl font-black text-green-600">
                        {formatCurrency(reportMetrics.netProfit)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 p-safe overflow-y-auto w-full print:hidden">
          <div className="bg-white w-full max-w-3xl rounded-[32px] shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 sm:p-8 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-2xl font-black text-[#0B192C]">
                  Detail Pesanan
                </h2>
                <p className="text-sm text-gray-500 font-mono mt-1">
                  {selectedOrder.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-95"
              >
                <X className="w-6 h-6 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto p-6 sm:p-8 space-y-8 flex-1">
              {/* Status Manager */}
              <div className="bg-[#F4F6F8] p-5 rounded-2xl flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                      Status Progres
                    </h4>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        "Menunggu Konfirmasi",
                        "Teknisi Ditugaskan",
                        "Sedang Dikerjakan",
                        "Selesai",
                      ].map((st) => (
                        <button
                          key={st}
                          onClick={() =>
                            saveOrder({
                              ...selectedOrder,
                              status: st as Order["status"],
                            })
                          }
                          className={`text-xs font-bold px-4 py-2 rounded-xl transition-all ${
                            selectedOrder.status === st ||
                            (st === "Menunggu Konfirmasi" &&
                              selectedOrder.status === "Pending")
                              ? st === "Selesai"
                                ? "bg-green-500 text-white shadow-md"
                                : st === "Sedang Dikerjakan"
                                  ? "bg-[#FFA800] text-[#0B192C] shadow-md"
                                  : st === "Teknisi Ditugaskan"
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "bg-[#0B192C] text-white shadow-md"
                              : "bg-white text-gray-500 hover:bg-gray-200 shadow-sm"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                      Lokasi Teknisi (Filter)
                    </h4>
                    <select
                      className="border border-gray-200 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-[#FFA800] outline-none font-bold text-[#0B192C] bg-white min-w-[200px] mb-3"
                      value={selectedOrder.techFilterLocation || ""}
                      onChange={(e) =>
                        saveOrder({
                          ...selectedOrder,
                          techFilterLocation: e.target.value,
                        })
                      }
                    >
                      <option value="">-- Semua Lokasi --</option>
                      <option value="Makassar">Makassar</option>
                      <option value="Gowa">Gowa</option>
                      <option value="Maros">Maros</option>
                    </select>

                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                      Tugaskan Teknisi{" "}
                      {selectedOrder.techFilterLocation && (
                        <span className="text-green-600">
                          (Rekomendasi {selectedOrder.techFilterLocation})
                        </span>
                      )}
                    </h4>
                    <select
                      value={selectedOrder.technician || ""}
                      onChange={(e) =>
                        saveOrder({
                          ...selectedOrder,
                          technician: e.target.value,
                        })
                      }
                      className="border border-gray-200 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-[#FFA800] outline-none font-bold text-[#0B192C] bg-white min-w-[200px]"
                    >
                      <option value="">-- Pilih Teknisi --</option>
                      {technicians
                        .filter(
                          (t) =>
                            !selectedOrder.techFilterLocation ||
                            t.location === selectedOrder.techFilterLocation,
                        )
                        .map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name} {t.location ? `(${t.location})` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => deleteOrder(selectedOrder.id)}
                      className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors shrink-0 flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Hapus
                    </button>
                    <button
                      onClick={() => handlePrintInvoice(selectedOrder)}
                      className="bg-[#0B192C] text-white hover:bg-[#FFA800] hover:text-[#0B192C] px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-colors w-full flex items-center justify-center gap-2"
                    >
                      <Printer className="w-4 h-4" /> Cetak Invoice PDF
                    </button>
                  </div>
                </div>
              </div>

              {/* Customer Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Pelanggan
                  </h4>
                  <p className="font-bold text-lg text-[#0B192C]">
                    {selectedOrder.customerName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-gray-600">
                      {selectedOrder.phone}
                    </p>
                    <a
                      href={getWhatsAppLink(
                        selectedOrder.phone,
                        selectedOrder.customerName,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 hover:text-green-700 bg-green-50 px-2 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Chat WA
                    </a>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedOrder.address}, {selectedOrder.area}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Jadwal Diminta
                  </h4>
                  <p className="font-medium text-[#0B192C]">
                    {selectedOrder.date}
                  </p>
                  <p className="font-medium text-[#0B192C] mt-1">
                    Pukul {selectedOrder.time}
                  </p>
                  {selectedOrder.notes && (
                    <div className="mt-3 bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-sm text-yellow-800">
                      <strong>Catatan:</strong> {selectedOrder.notes}
                    </div>
                  )}
                </div>
              </div>

              {/* Items & Costs */}
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
                  Rincian Biaya
                </h4>
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F4F6F8] text-gray-500 uppercase text-[11px] font-bold">
                      <tr>
                        <th className="px-5 py-3">Deskripsi</th>
                        <th className="px-5 py-3 text-center">Qty</th>
                        <th className="px-5 py-3 text-right">Harga</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(selectedOrder.items || []).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-5 py-4 font-medium text-[#0B192C]">
                            {it.name}
                          </td>
                          <td className="px-5 py-4 text-center">
                            {it.quantity}
                          </td>
                          <td className="px-5 py-4 text-right font-medium">
                            {formatCurrency(it.price * it.quantity)}
                          </td>
                        </tr>
                      ))}
                      {selectedOrder.extraCosts?.map((cost, idx) => (
                        <tr key={"extra-" + idx} className="bg-red-50/30">
                          <td className="px-5 py-4 font-medium text-[#0B192C]">
                            {cost.description}{" "}
                            <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded ml-2">
                              Tambahan
                            </span>
                          </td>
                          <td className="px-5 py-4 text-center">1</td>
                          <td className="px-5 py-4 text-right font-medium">
                            {formatCurrency(cost.amount)}
                          </td>
                        </tr>
                      ))}

                      {selectedOrder.promo && (
                        <tr className="bg-green-50/50">
                          <td
                            colSpan={2}
                            className="px-5 py-3 text-right font-bold text-green-700"
                          >
                            Promo ({selectedOrder.promo.code})
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-green-700">
                            -{formatCurrency(selectedOrder.promo.discount)}
                          </td>
                        </tr>
                      )}
                      <tr className="bg-[#0B192C]">
                        <td
                          colSpan={2}
                          className="px-5 py-4 text-right font-black text-white text-base"
                        >
                          TOTAL TAGIHAN
                        </td>
                        <td className="px-5 py-4 text-right font-black text-[#FFA800] text-lg">
                          {formatCurrency(calculateFinalTotal(selectedOrder))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {isOwner && (
                  <div className="mt-4 flex flex-col sm:flex-row gap-4 text-sm font-bold bg-[#E8F0FE] p-4 rounded-xl border border-blue-100">
                    <div className="flex-1 text-blue-900 border-b sm:border-b-0 sm:border-r border-blue-200 pb-2 sm:pb-0 sm:pr-4">
                      <span className="block text-[10px] uppercase text-blue-600 mb-1 tracking-wider">
                        Fee Teknisi (70% Jasa + Biaya Sparepart Luar)
                      </span>
                      <span className="text-xl">
                        {formatCurrency(
                          calculateOrderSplit(selectedOrder).techCut,
                        )}
                      </span>
                    </div>
                    <div className="flex-1 text-green-900">
                      <span className="block text-[10px] uppercase text-green-600 mb-1 tracking-wider">
                        Pendapatan JAGO AC (30% Jasa + Sparepart JAGO AC)
                      </span>
                      <span className="text-xl">
                        {formatCurrency(
                          calculateOrderSplit(selectedOrder).mgmtCut,
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Add Extra Cost Form */}
                <div className="mt-6 bg-[#FCFBF8] border border-gray-200 p-5 rounded-2xl">
                  <h4 className="text-sm font-bold text-[#0B192C] mb-3 flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Tambah Biaya Ekstra (Manual)
                  </h4>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <select
                      value={newExtraCostType}
                      onChange={(e) =>
                        setNewExtraCostType(e.target.value as ExtraCost["type"])
                      }
                      className="w-full sm:w-40 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-[#0B192C] outline-none"
                    >
                      <option value="Jasa">Jasa / Servis</option>
                      <option value="Sparepart JAGO AC">
                        Sparepart (JAGO AC)
                      </option>
                      <option value="Sparepart Luar">
                        Sparepart (Beli di Luar)
                      </option>
                    </select>
                    <input
                      type="text"
                      placeholder="Deskripsi (Misal: Tambah Freon 10psi)"
                      value={newExtraCostDesc}
                      onChange={(e) => setNewExtraCostDesc(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-[#0B192C] outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Nominal (Rp)"
                      value={newExtraCostAmount}
                      onChange={(e) => setNewExtraCostAmount(e.target.value)}
                      className="w-full sm:w-40 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-[#0B192C] outline-none"
                    />
                    <button
                      onClick={addExtraCost}
                      disabled={!newExtraCostDesc || !newExtraCostAmount}
                      className="bg-[#0B192C] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-sm transition-transform active:scale-95"
                    >
                      Tambahkan
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Inventory Modal */}
      {isInventoryModalOpen && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 sm:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-[#0B192C]">
                {editingInventory ? "Edit Item" : "Tambah Item"}
              </h3>
              <button onClick={() => setIsInventoryModalOpen(false)}>
                <X className="w-5 h-5 text-gray-500 hover:text-black" />
              </button>
            </div>
            <form onSubmit={saveInventoryItem} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Nama Item/Sparepart
                </label>
                <input
                  type="text"
                  required
                  value={inventoryForm.name}
                  onChange={(e) =>
                    setInventoryForm({ ...inventoryForm, name: e.target.value })
                  }
                  className="w-full border p-3 rounded-xl"
                  placeholder="Cth: Pipa AC"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Stok Tersedia
                  </label>
                  <input
                    type="number"
                    required
                    value={inventoryForm.stock}
                    onChange={(e) =>
                      setInventoryForm({
                        ...inventoryForm,
                        stock: e.target.value,
                      })
                    }
                    className="w-full border p-3 rounded-xl"
                    placeholder="Cth: 10"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Satuan
                  </label>
                  <input
                    type="text"
                    required
                    value={inventoryForm.unit}
                    onChange={(e) =>
                      setInventoryForm({
                        ...inventoryForm,
                        unit: e.target.value,
                      })
                    }
                    className="w-full border p-3 rounded-xl"
                    placeholder="Cth: Pcs, Meter"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Harga Beli Satuan (Rp)
                </label>
                <input
                  type="number"
                  required
                  value={inventoryForm.price}
                  onChange={(e) =>
                    setInventoryForm({
                      ...inventoryForm,
                      price: e.target.value,
                    })
                  }
                  className="w-full border p-3 rounded-xl"
                  placeholder="Cth: 50000"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#0B192C] text-white font-bold p-3 rounded-xl hover:bg-black transition-colors !mt-6"
              >
                Simpan Item
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manual Order Modal */}
      {isAddingOrder && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 sm:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-[#0B192C]">
                Input Pesanan Manual
              </h3>
              <button onClick={() => setIsAddingOrder(false)}>
                <X className="w-5 h-5 text-gray-500 hover:text-black" />
              </button>
            </div>
            <form
              onSubmit={handleAddManualOrder}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <div className="space-y-4">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  Informasi Pelanggan
                </h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    Nama Lengkap
                  </label>
                  <input
                    required
                    type="text"
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none"
                    placeholder="Contoh: Budi Santoso"
                    value={newOrder.customerName || ""}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, customerName: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    No. WhatsApp
                  </label>
                  <input
                    required
                    type="tel"
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none"
                    placeholder="0812xxxx"
                    value={newOrder.phone || ""}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, phone: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    Area / Wilayah
                  </label>
                  <select
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none"
                    value={newOrder.area || ""}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, area: e.target.value })
                    }
                  >
                    <option value="">Pilih Area</option>
                    <option value="Makassar">Makassar</option>
                    <option value="Gowa">Gowa</option>
                    <option value="Maros">Maros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    Alamat Lengkap
                  </label>
                  <textarea
                    required
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none h-24 resize-none"
                    placeholder="Nama jalan, nomor rumah, RT/RW..."
                    value={newOrder.address || ""}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, address: e.target.value })
                    }
                  ></textarea>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  Jadwal & Status
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                      Tanggal
                    </label>
                    <input
                      required
                      type="date"
                      className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none"
                      value={newOrder.date || ""}
                      onChange={(e) =>
                        setNewOrder({ ...newOrder, date: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                      Jam
                    </label>
                    <input
                      required
                      type="time"
                      className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none"
                      value={newOrder.time || ""}
                      onChange={(e) =>
                        setNewOrder({ ...newOrder, time: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    Status Awal
                  </label>
                  <select
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#0B192C]/20 outline-none"
                    value={newOrder.status || "Pending"}
                    onChange={(e) =>
                      setNewOrder({
                        ...newOrder,
                        status: e.target.value as any,
                      })
                    }
                  >
                    <option value="Pending">Baru (Belum Diproses)</option>
                    <option value="Sedang Dikerjakan">Sedang Dikerjakan</option>
                    <option value="Teknisi Ditugaskan">
                      Teknisi Ditugaskan
                    </option>
                    <option value="Selesai">Selesai (Langsung Selesai)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">
                    Catatan Tambahan
                  </label>
                  <textarea
                    className="w-full bg-[#F4F6F8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#FFA800]/50 outline-none h-24 resize-none"
                    placeholder="Merk AC, keluhan spesifik, dll..."
                    value={newOrder.notes || ""}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, notes: e.target.value })
                    }
                  ></textarea>
                </div>
              </div>

              <div className="md:col-span-2 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                  Pilih Layanan
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                  {SERVICES_LIST.map((service) => {
                    const sid = service.id;
                    const price = servicePrices[sid] || service.defaultPrice;
                    const currentItem = (newOrder.services || []).find(
                      (s) => s.name === service.name,
                    );
                    const qty = currentItem ? currentItem.quantity : 0;

                    return (
                      <div
                        key={sid}
                        className="flex items-center justify-between bg-[#F4F6F8] p-3 rounded-xl"
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-[#0B192C] leading-tight">
                            {service.name}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {formatCurrency(price)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const currentServices = [
                                ...(newOrder.services || []),
                              ];
                              const index = currentServices.findIndex(
                                (s) => s.name === service.name,
                              );
                              if (index > -1) {
                                if (qty <= 1) currentServices.splice(index, 1);
                                else currentServices[index].quantity -= 1;
                              }
                              setNewOrder({
                                ...newOrder,
                                services: currentServices,
                              });
                            }}
                            className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors shadow-sm"
                          >
                            -
                          </button>
                          <span className="text-xs font-black w-4 text-center">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const currentServices = [
                                ...(newOrder.services || []),
                              ];
                              const index = currentServices.findIndex(
                                (s) => s.name === service.name,
                              );
                              if (index > -1)
                                currentServices[index].quantity += 1;
                              else
                                currentServices.push({
                                  name: service.name,
                                  price,
                                  quantity: 1,
                                });
                              setNewOrder({
                                ...newOrder,
                                services: currentServices,
                              });
                            }}
                            className="w-6 h-6 rounded-full bg-[#0B192C] flex items-center justify-center text-[#FFA800] hover:brightness-110 transition-colors shadow-sm"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-2 pt-6 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-center sm:text-left">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    Estimasi Total
                  </span>
                  <span className="text-2xl font-black text-[#0B192C]">
                    {formatCurrency(calculateFinalTotal(newOrder as Order))}
                  </span>
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto bg-[#0B192C] text-[#FFA800] px-10 py-4 rounded-2xl font-black text-sm hover:brightness-110 shadow-lg shadow-blue-900/10 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" /> Simpan Pesanan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Technician Report Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 bg-[#0B192C] text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-[#FFA800]">
                  Detail Laporan Teknisi
                </h3>
                <p className="text-xs text-blue-200">
                  ID Pesanan: {selectedReport.orderId} | Pelanggan:{" "}
                  {selectedReport.customerName}
                </p>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Checklists */}
                <div className="space-y-6">
                  <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
                    <h4 className="text-sm font-black text-blue-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" /> Checklist Indoor
                    </h4>
                    <div className="grid grid-cols-1 gap-4">
                      {Object.entries(selectedReport.indoorChecklist).map(
                        ([key, item]: [string, any]) => (
                          <div
                            key={key}
                            className="bg-white p-3 rounded-2xl border border-blue-200 flex flex-col gap-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="capitalize text-gray-700 font-bold text-xs">
                                {key}
                              </span>
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                  item.status === "Normal"
                                    ? "bg-green-100 text-green-700"
                                    : item.status === "Bermasalah"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-gray-200 text-gray-500"
                                }`}
                              >
                                {item.status}
                              </span>
                            </div>
                            {item.status === "Bermasalah" && item.issue && (
                              <p className="text-[10px] text-red-600 italic bg-red-50 p-1.5 rounded-lg border border-red-50 mt-1">
                                Ket: {item.issue}
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="bg-orange-50 p-6 rounded-3xl border border-orange-100">
                    <h4 className="text-sm font-black text-orange-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" /> Checklist Outdoor
                    </h4>
                    <div className="grid grid-cols-1 gap-4">
                      {Object.entries(selectedReport.outdoorChecklist).map(
                        ([key, item]: [string, any]) => (
                          <div
                            key={key}
                            className="bg-white p-3 rounded-2xl border border-orange-200 flex flex-col gap-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="capitalize text-gray-700 font-bold text-xs">
                                {key.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                  item.status === "Normal"
                                    ? "bg-green-100 text-green-700"
                                    : item.status === "Bermasalah"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-gray-200 text-gray-500"
                                }`}
                              >
                                {item.status}
                              </span>
                            </div>
                            {item.status === "Bermasalah" && item.issue && (
                              <p className="text-[10px] text-red-600 italic bg-red-50 p-1.5 rounded-lg border border-red-50 mt-1">
                                Ket: {item.issue}
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                      Catatan Teknisi
                    </h4>
                    <p className="text-sm text-gray-700 italic">
                      {selectedReport.notes || "Tidak ada catatan."}
                    </p>
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">
                        Dilaporkan Oleh:
                      </p>
                      <p className="text-sm font-black text-[#0B192C]">
                        {selectedReport.technicianName}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(selectedReport.timestamp).toLocaleString(
                          "id-ID",
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Photos */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      Foto Sebelum Pengerjaan
                    </label>
                    <div className="aspect-video bg-gray-100 rounded-3xl overflow-hidden border border-gray-200 relative">
                      {selectedReport.photoBefore ? (
                        <>
                          <img
                            src={selectedReport.photoBefore}
                            className="w-full h-full object-cover"
                            alt="Before"
                          />
                          <div className="absolute bottom-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-[10px] font-black backdrop-blur-sm border border-white/20">
                            {new Date(selectedReport.timestamp).toLocaleString(
                              "id-ID",
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs italic">
                          Tidak ada foto.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      Foto Sesudah Pengerjaan
                    </label>
                    <div className="aspect-video bg-gray-100 rounded-3xl overflow-hidden border border-gray-200 relative">
                      {selectedReport.photoAfter ? (
                        <>
                          <img
                            src={selectedReport.photoAfter}
                            className="w-full h-full object-cover"
                            alt="After"
                          />
                          <div className="absolute bottom-4 left-4 bg-orange-600/80 text-white px-3 py-1 rounded-full text-[10px] font-black border border-white/20">
                            {new Date(selectedReport.timestamp).toLocaleString(
                              "id-ID",
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs italic">
                          Belum dikerjakan / Belum ada foto.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t flex flex-wrap justify-end gap-3">
              <a
                href={getReportWhatsAppLink(selectedReport)}
                target="_blank"
                rel="no-referrer"
                className="flex-1 sm:flex-none bg-green-600 text-white px-6 py-3 rounded-2xl font-black text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" /> Kirim WA
              </a>
              <button
                onClick={() => generateReportPdf(selectedReport)}
                className="flex-1 sm:flex-none bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" /> Download Checklist
              </button>
              <button
                onClick={() => setSelectedReport(null)}
                className="flex-1 sm:flex-none bg-[#0B192C] text-[#FFA800] px-8 py-3 rounded-2xl font-black text-sm hover:brightness-110 transition-all"
              >
                Tutup Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Preview Modal */}
      {invoicePreviewUrl && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 sm:p-8 w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="text-xl font-black text-[#0B192C]">
                Preview Invoice
              </h3>
              <button
                onClick={() => {
                  setInvoicePreviewUrl(null);
                  setInvoiceOrderPreview(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500 hover:text-black" />
              </button>
            </div>

            <div className="flex-1 h-[70vh] w-full rounded-xl overflow-hidden border border-gray-200 bg-gray-50 mb-6">
              <iframe
                src={`${invoicePreviewUrl}#toolbar=0&view=FitH`}
                className="w-full h-full border-none"
                title="Invoice Preview"
              />
            </div>

            <div className="flex justify-end gap-3 shrink-0">
              <button
                onClick={() => {
                  setInvoicePreviewUrl(null);
                  setInvoiceOrderPreview(null);
                }}
                className="px-6 py-3 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
              >
                Batal
              </button>
              <button
                onClick={handleDownloadInvoice}
                className="px-6 py-3 font-bold text-[#0B192C] bg-[#FFA800] hover:bg-yellow-400 rounded-xl shadow-lg transition flex items-center gap-2"
              >
                <Download className="w-5 h-5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promo Modal */}
      {isPromoModalOpen && (
        <div className="fixed inset-0 bg-[#0B192C]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl p-6 sm:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black text-[#0B192C]">
                {editingPromo ? "Edit Voucher" : "Tambah Voucher"}
              </h3>
              <button onClick={() => setIsPromoModalOpen(false)}>
                <X className="w-5 h-5 text-gray-500 hover:text-black" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Kode Voucher
                </label>
                <input
                  type="text"
                  disabled={!!editingPromo}
                  value={promoForm.id}
                  onChange={(e) =>
                    setPromoForm({
                      ...promoForm,
                      id: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full border p-3 rounded-xl disabled:bg-gray-100"
                  placeholder="Cth: DISKON20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Potongan Harga (Rp)
                </label>
                <input
                  type="number"
                  value={promoForm.discount}
                  onChange={(e) =>
                    setPromoForm({ ...promoForm, discount: e.target.value })
                  }
                  className="w-full border p-3 rounded-xl"
                  placeholder="Cth: 20000"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Minimal Transaksi (Rp)
                </label>
                <input
                  type="number"
                  value={promoForm.minTransaction}
                  onChange={(e) =>
                    setPromoForm({
                      ...promoForm,
                      minTransaction: e.target.value,
                    })
                  }
                  className="w-full border p-3 rounded-xl"
                  placeholder="Cth: 400000 (0 = tanpa minimal)"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Batas Harian
                  </label>
                  <input
                    type="number"
                    value={promoForm.maxUsagePerDay}
                    onChange={(e) =>
                      setPromoForm({
                        ...promoForm,
                        maxUsagePerDay: e.target.value,
                      })
                    }
                    className="w-full border p-3 rounded-xl"
                    placeholder="0 = tanpa batas"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Batas Total
                  </label>
                  <input
                    type="number"
                    value={promoForm.maxUsageTotal}
                    onChange={(e) =>
                      setPromoForm({
                        ...promoForm,
                        maxUsageTotal: e.target.value,
                      })
                    }
                    className="w-full border p-3 rounded-xl"
                    placeholder="0 = tanpa batas"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Berlaku Mulai
                  </label>
                  <input
                    type="date"
                    value={promoForm.startDate}
                    onChange={(e) =>
                      setPromoForm({ ...promoForm, startDate: e.target.value })
                    }
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                    Berlaku Sampai
                  </label>
                  <input
                    type="date"
                    value={promoForm.endDate}
                    onChange={(e) =>
                      setPromoForm({ ...promoForm, endDate: e.target.value })
                    }
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Syarat Layanan (Opsional)
                </label>
                <select
                  value={promoForm.requirement}
                  onChange={(e) =>
                    setPromoForm({ ...promoForm, requirement: e.target.value })
                  }
                  className="w-full border p-3 rounded-xl"
                >
                  <option value="">Semua Layanan</option>
                  <option value="cuci">Khusus Cuci AC</option>
                </select>
              </div>
              <label className="flex items-center gap-2 mt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={promoForm.isActive}
                  onChange={(e) =>
                    setPromoForm({ ...promoForm, isActive: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#0B192C]"
                />
                <span className="font-bold text-[#0B192C]">Voucher Aktif</span>
              </label>
              <button
                onClick={async () => {
                  if (!promoForm.id || !promoForm.discount) return;
                  try {
                    const promoData = {
                      id: promoForm.id,
                      discount: Number(promoForm.discount),
                      isActive: promoForm.isActive,
                      maxUsageTotal: Number(promoForm.maxUsageTotal) || 0,
                      maxUsagePerDay: Number(promoForm.maxUsagePerDay) || 0,
                      requirement: promoForm.requirement,
                      description: promoForm.description,
                      startDate: promoForm.startDate,
                      endDate: promoForm.endDate,
                      minTransaction: Number(promoForm.minTransaction) || 0,
                      usedTotal: editingPromo ? editingPromo.usedTotal : 0,
                      usedToday: editingPromo ? editingPromo.usedToday : 0,
                      lastUsedDate: editingPromo
                        ? editingPromo.lastUsedDate
                        : "",
                    };
                    await setDoc(doc(db, "promos", promoForm.id), promoData);
                    setIsPromoModalOpen(false);
                  } catch (err) {
                    console.error(err);
                    alert("Gagal menyimpan voucher");
                  }
                }}
                className="w-full bg-[#0B192C] text-white font-bold p-3 rounded-xl hover:bg-black transition-colors"
              >
                Simpan Voucher
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
