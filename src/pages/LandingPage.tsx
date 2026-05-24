import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, setDoc, getDoc, updateDoc, increment, collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  Snowflake, ShoppingCart, Plus, Minus, X,
  MessageCircle, Droplets, Wind, Wrench, Flame, Search, Settings, 
  Check, ShieldCheck, Clock, ThumbsUp, Menu, ChevronDown, Star, MapPin, Calendar, MapPin as MapIcon,
  Phone, Mail, RefreshCw
} from 'lucide-react';

const phoneNumber = "6285156388993";

const servicesData = [
  { id: 1, name: 'Jasa Cuci AC Split', price: 75000, category: 'Maintenance', icon: Snowflake, desc: 'Cuci bersih indoor + outdoor semua PK' },
  { id: 2, name: 'Isi Freon AC R22 / R32', price: 150000, category: 'Freon', icon: Wind, desc: 'Pengisian freon standar' },
  { id: 3, name: 'Isi Freon AC R410A', price: 200000, category: 'Freon', icon: Wind, desc: 'Pengisian freon tipe inverter' },
  { id: 4, name: 'Isi Full Freon R32 / R410a', price: 300000, category: 'Freon', icon: Wind, desc: 'Pengisian freon dari kosong' },
  { id: 5, name: 'Isi Full Freon R22', price: 350000, category: 'Freon', icon: Wind, desc: 'Pengisian freon dari kosong' },
  { id: 6, name: 'Jasa Bongkar AC', price: 150000, category: 'Bongkar Pasang', icon: Wrench, desc: 'Bongkar AC split dari dinding' },
  { id: 7, name: 'Jasa Instalasi AC Split', price: 250000, category: 'Bongkar Pasang', icon: Settings, desc: 'Pasang AC split baru' },
  { id: 8, name: 'Jasa Bongkar & Pasang AC Split', price: 350000, category: 'Bongkar Pasang', icon: Settings, desc: 'Bongkar lalu pasang ulang AC' },
  { id: 9, name: 'Las Pipa Bocor Jasa', price: 150000, category: 'Perbaikan', icon: Flame, desc: 'Perbaikan instalasi pipa AC' },
  { id: 10, name: 'Biaya Pengecekan', price: 50000, category: 'Pengecekan', icon: Search, desc: 'Pengecekan kerusakan unit' },
];

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
};

export default function App() {
  const [dynamicServices, setDynamicServices] = useState(servicesData);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const servicesRef = useRef<HTMLElement>(null);
  const [cartPosition, setCartPosition] = useState<'hidden' | 'fixed' | 'absolute'>('hidden');
  const [activePromos, setActivePromos] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'services'), (snap) => {
      if (snap.exists()) {
        const customPrices = snap.data().prices || {};
        const customNames = snap.data().names || {};
        setDynamicServices(servicesData.map(s => ({
          ...s,
          price: customPrices[s.id] !== undefined ? customPrices[s.id] : s.price,
          name: customNames[s.id] !== undefined ? customNames[s.id] : s.name
        })));
      }
    }, (error) => {
      console.error("Error loading service settings:", error);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'promos'), where('isActive', '==', true));
    const unsub = onSnapshot(q, (snap) => {
       const promos: any[] = [];
       snap.forEach(doc => {
          promos.push({ id: doc.id, ...doc.data() });
       });
       setActivePromos(promos);
    }, (error) => {
       console.error("Error fetching promos");
    });
    return unsub;
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (!servicesRef.current) return;
      const rect = servicesRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      if (rect.top > viewportHeight) {
        setCartPosition('hidden');
      } else if (rect.bottom >= viewportHeight) {
        setCartPosition('fixed');
      } else {
        setCartPosition('absolute');
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Form State
  const [formData, setFormData] = useState({
    tanggal: '',
    jam: '',
    nama: '',
    nohp: '',
    wilayah: '',
    alamat: '',
    catatan: ''
  });
  
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{code: string, discount: number, data?: any} | null>(null);

  // Tracking Order State
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);
  const [trackingId, setTrackingId] = useState('');
  const [trackedOrders, setTrackedOrders] = useState<any[]>([]);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');

  const handleTrackOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingId) return;
    setIsTrackingLoading(true);
    setTrackingError('');
    try {
      const docRef = doc(db, 'orders', trackingId.toUpperCase());
      const snap = await import('firebase/firestore').then(mod => mod.getDocFromServer(docRef));
      if (!snap.exists()) {
        setTrackingError('Pesanan dengan ID ini tidak ditemukan.');
        setTrackedOrders([]);
      } else {
        setTrackedOrders([snap.data()]);
      }
    } catch(err) {
      setTrackingError('Terjadi kesalahan. Silakan coba lagi.');
      handleFirestoreError(err, OperationType.GET, `orders/${trackingId.toUpperCase()}`);
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => {
      const current = prev[id] || 0;
      const next = Math.max(0, current + delta);
      const newCart = { ...prev };
      if (next === 0) {
        delete newCart[id];
      } else {
        newCart[id] = next;
      }
      return newCart;
    });
  };

  const totalItems: number = Number(Object.values(cart).reduce((sum: number, qty) => sum + Number(qty), 0));
  const subTotal: number = Object.entries(cart).reduce((sum: number, [id, qty]) => {
     const service = dynamicServices.find(s => s.id === Number(id));
     return sum + (service ? service.price * (qty as number) : 0);
  }, 0);
  const totalPrice: number = Math.max(0, subTotal - (appliedPromo?.discount || 0));

  // Snowflake Effect Logic
  const [snowflakes, setSnowflakes] = useState<{id: number, left: number, startDelay: number, size: number}[]>([]);
  const snowflakeCounter = useRef(0);

  const handleACClick = () => {
    const newSnowflakes = Array.from({ length: 8 }).map(() => ({
      id: snowflakeCounter.current++,
      left: Math.random() * 100,
      startDelay: Math.random() * 0.5,
      size: 10 + Math.random() * 15
    }));
    setSnowflakes(prev => [...prev, ...newSnowflakes]);
    
    // Cleanup after animation
    setTimeout(() => {
      setSnowflakes(prev => prev.filter(s => !newSnowflakes.find(ns => ns.id === s.id)));
    }, 3000);
  };

  const handleApplyPromo = async () => {
    if (!promoCode) return;
    try {
      const code = promoCode.toUpperCase();
      const promoSnap = await getDoc(doc(db, 'promos', code));
      if (promoSnap.exists()) {
        const promoData = promoSnap.data();
        if (!promoData.isActive) {
          alert('Promo ini sudah tidak aktif.');
          return;
        }

        const todayStr = new Date().toLocaleDateString('en-CA');
        let currentDayUsage = promoData.usedToday || 0;
        if (promoData.lastUsedDate !== todayStr) {
          currentDayUsage = 0;
        }

        if (promoData.maxUsagePerDay > 0 && currentDayUsage >= promoData.maxUsagePerDay) {
          alert('Kuota penggunaan voucher hari ini sudah penuh.');
          return;
        }

        if (promoData.maxUsageTotal > 0 && (promoData.usedTotal || 0) >= promoData.maxUsageTotal) {
          alert('Voucher ini sudah mencapai batas maksimal penggunaan secara keseluruhan.');
          return;
        }

        if (promoData.requirement === 'cuci' && (!cart[1] || cart[1] === 0)) {
           alert('Promo ini hanya berlaku untuk Jasa Cuci AC.');
           return;
        }

        if (promoData.minTransaction > 0 && subTotal < promoData.minTransaction) {
          alert(`Minimal transaksi untuk menggunakan voucher ini adalah ${formatCurrency(promoData.minTransaction)}.`);
          return;
        }
        
        setAppliedPromo({ code: promoSnap.id, discount: promoData.discount, data: promoData });
        alert(`Promo berhasil digunakan! Anda hemat ${formatCurrency(promoData.discount)}`);
      } else {
        alert('Kode promo tidak valid atau tidak ditemukan.');
        setAppliedPromo(null);
      }
    } catch (err) {
      console.error(err);
      alert('Gagal mengecek promo, pastikan koneksi lancar.');
    }
  };

  const submitCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cartItems = Object.entries(cart).map(([id, quantity]) => {
      const service = dynamicServices.find(s => s.id === Number(id))!;
      const { icon, ...serviceWithoutIcon } = service;
      return { ...serviceWithoutIcon, quantity: quantity as number };
    });
    
    if (cartItems.length === 0) return;
    
    const orderId = `JGO-${Math.floor(100000 + Math.random() * 900000)}`;
    
    let message = `*PESANAN BARU JAGO AC*\n\n`;
    message += `*Kode Pesanan:* ${orderId}\n\n`;
    message += `*Data Pelanggan*\n`;
    message += `Nama: ${formData.nama}\n`;
    message += `No. HP/WA: ${formData.nohp}\n`;
    message += `Wilayah: ${formData.wilayah}\n`;
    message += `Alamat: ${formData.alamat}\n`;
    if(formData.catatan) message += `Catatan: ${formData.catatan}\n`;
    message += `\n*Jadwal Pengerjaan*\n`;
    message += `Tanggal: ${formData.tanggal}\n`;
    message += `Jam: ${formData.jam}\n`;
    message += `\n*Rincian Pesanan*\n`;
    
    cartItems.forEach(item => {
      message += `- ${item.name} (${item.quantity}x) : ${formatCurrency(item.price * item.quantity)}\n`;
    });
    
    message += `\nSubtotal: ${formatCurrency(subTotal)}\n`;
    if (appliedPromo) {
      message += `Promo (${appliedPromo.code}): -${formatCurrency(appliedPromo.discount)}\n`;
    }
    message += `*Total Tagihan: ${formatCurrency(totalPrice)}*\n\n`;
    message += `Catatan: *Simpan kode pesanan Anda untuk melacak di website.*\n\n`;
    message += `Mohon segera dikonfirmasi. Terima kasih!`;
    
    // Save to localStorage for Admin Dashboard
    const orderData = {
      id: orderId,
      customerName: formData.nama,
      phone: formData.nohp,
      address: formData.alamat,
      area: formData.wilayah,
      date: formData.tanggal,
      time: formData.jam,
      notes: formData.catatan,
      items: cartItems,
      subTotal,
      promo: appliedPromo,
      total: totalPrice,
      status: 'Pending',
      createdAt: new Date().toISOString(),
      extraCosts: []
    };
    
    try {
      if (appliedPromo && appliedPromo.data) {
        const promoRef = doc(db, 'promos', appliedPromo.code);
        const todayStr = new Date().toLocaleDateString('en-CA');
        let currentDayUsage = appliedPromo.data.usedToday || 0;
        if (appliedPromo.data.lastUsedDate !== todayStr) {
           currentDayUsage = 0;
        }

        await updateDoc(promoRef, {
           usedTotal: increment(1),
           usedToday: currentDayUsage + 1,
           lastUsedDate: todayStr
        });
      }

      await setDoc(doc(db, 'orders', orderData.id), orderData);
    } catch (error) {
      console.error('Gagal menyimpan pesanan ke database', error);
      alert('Gagal menyimpan pesanan. Terjadi kesalahan pada server.');
      // We do not return here. We want to ensure the customer can still message via WhatsApp even if the database fails!
    }

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${phoneNumber}?text=${encodedMessage}`, '_blank');
    setIsCheckoutOpen(false);
  };

  const openWhatsAppGeneral = () => {
    const text = encodeURIComponent("Halo JAGO AC, nanya dulu boleh?");
    window.open(`https://wa.me/${phoneNumber}?text=${text}`, '_blank');
  };

  const BrandSymbol = ({ className, isDark }: { className?: string, isDark?: boolean }) => {
    const blueColor = isDark ? '#FFFFFF' : '#143760';
    const yellowColor = '#F49F1C';
    
    return (
      <svg viewBox="0 0 100 100" className={className} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Branches */}
        <g stroke={blueColor} strokeWidth="7">
          {/* Top */}
          <line x1="50" y1="41" x2="50" y2="12" />
          <line x1="50" y1="27" x2="38" y2="15" />
          <line x1="50" y1="27" x2="62" y2="15" />

          {/* Bottom Right */}
          <line x1="57" y1="53" x2="83" y2="68" />
          <line x1="70" y1="60" x2="82" y2="53" />
          <line x1="70" y1="60" x2="70" y2="74" />

          {/* Bottom */}
          <line x1="50" y1="59" x2="50" y2="88" />
          <line x1="50" y1="73" x2="38" y2="85" />
          <line x1="50" y1="73" x2="62" y2="85" />
          
          {/* Top Left */}
          <line x1="43" y1="45" x2="17" y2="30" />
          <line x1="30" y1="38" x2="18" y2="45" />
          <line x1="30" y1="38" x2="30" y2="24" />
        </g>

        {/* Bottom Left - Yellow */}
        <g stroke={yellowColor} strokeWidth="7">
          <line x1="43" y1="53" x2="17" y2="68" />
          <line x1="30" y1="60" x2="18" y2="53" />
          <line x1="30" y1="60" x2="30" y2="74" />
        </g>

        {/* Checkmark / Arrow */}
        {/* Dark blue background for checkmark */}
        <path d="M41 53 L50 63 L82 28" stroke={blueColor} strokeWidth="14" strokeLinejoin="miter" strokeLinecap="square" />
        <polygon points="66,28 90,19 82,43" fill={blueColor} />
        
        {/* Yellow foreground for checkmark */}
        <path d="M43 51 L50 59 L80 26" stroke={yellowColor} strokeWidth="8" strokeLinejoin="miter" strokeLinecap="square" />
        <polygon points="67,25 87,17 80,38" fill={yellowColor} />
      </svg>
    );
  };

  const Logo = ({ isDark = false, variant = 'horizontal', className = '' }: { isDark?: boolean, variant?: 'horizontal' | 'vertical', className?: string }) => {
    const textColor = isDark ? 'text-white' : 'text-[#143760]';
    const bgColor = isDark ? 'bg-white text-[#143760]' : 'bg-[#143760] text-white';
    
    if (variant === 'vertical') {
      return (
        <div className={`flex flex-col items-center justify-center ${className}`}>
          <BrandSymbol isDark={isDark} className="w-28 h-28 mb-3" />
          <div className="flex items-center space-x-2.5 uppercase leading-none mb-2">
            <span className={`text-[46px] font-black tracking-[-0.04em] ${textColor}`} style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>JAGO</span>
            <span className={`text-[30px] font-black px-3 py-1.5 rounded-xl ${bgColor}`} style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', paddingBottom: '4px' }}>AC</span>
          </div>
          <span className={`text-[15px] font-bold tracking-wide ${textColor}`}>Jagonya Bikin Dingin</span>
        </div>
      );
    }

    return (
      <div className={`flex items-center space-x-2 sm:space-x-3 gap-0.5 sm:gap-1 ${className}`}>
        <BrandSymbol isDark={isDark} className="w-10 h-10 sm:w-[52px] sm:h-[52px]" />
        <div className="flex flex-col justify-center">
          <div className="flex items-center space-x-1 sm:space-x-1.5 uppercase leading-none mb-0.5 sm:mb-1">
            <span className={`text-[20px] sm:text-[26px] font-black tracking-[-0.04em] ${textColor}`} style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>JAGO</span>
            <span className={`text-[12px] sm:text-[16px] font-black px-1 sm:px-1.5 rounded-[4px] sm:rounded-md ${bgColor}`} style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', paddingBottom: '2px' }}>AC</span>
          </div>
          <span className={`text-[8.5px] sm:text-[10.5px] font-bold tracking-wide ${textColor}`}>Jagonya Bikin Dingin</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FCFBF8] font-sans text-slate-800 overflow-x-hidden relative w-full">
      {/* Promo Banner */}
      {activePromos.length > 0 && (
        <div className="bg-[#F4F6F8] text-center py-2 px-4 flex items-center justify-center relative">
          <p className="text-[11px] font-medium text-[#0A192F] max-w-[80%] leading-relaxed">
            🎉 Promo Spesial — Diskon {formatCurrency(activePromos[0].discount)}! Pakai kode: <br/> 
            <span className="inline-block bg-[#0B192C] text-white px-2 py-0.5 rounded mt-1 font-bold">{activePromos[0].id}</span>
          </p>
        </div>
      )}

      {/* Header & Hero Wrapper */}
      <div className="bg-[#0B192C] w-full text-white pb-20 lg:pb-28 rounded-b-[40px] shadow-lg relative z-20">
        {/* Header */}
        <header className="sticky top-0 bg-[#0B192C]/95 backdrop-blur-md z-40 px-4 py-4 flex items-center justify-between border-b border-white/10">
          <Logo isDark={true} />
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button 
               onClick={() => setIsTrackingModalOpen(true)}
               className="hidden sm:flex bg-white/10 hover:bg-white/20 text-white font-bold text-sm px-4 py-2.5 rounded-full transition-all active:scale-95 shadow-sm items-center gap-1.5"
            >
               <Search className="w-4 h-4"/> Cek Pesanan
            </button>
            <button 
               onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
               className="bg-[#FFA800] hover:bg-white text-[#0B192C] font-bold text-sm px-4 sm:px-5 py-2 sm:py-2.5 rounded-full transition-all active:scale-95 shadow-sm"
            >
              Pesan Sekarang
            </button>
            <button 
               onClick={() => setIsMobileMenuOpen(true)}
               className="p-1 sm:p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95"
            >
               <Menu className="w-6 h-6 text-white" />
            </button>
          </div>
        </header>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              {/* Overlay */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-[#0B192C]/60 backdrop-blur-[2px]"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              
              {/* Menu Container */}
              <motion.div 
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                onClick={(e) => e.stopPropagation()}
                className="fixed right-4 sm:right-0 top-[84px] sm:top-0 bottom-auto sm:bottom-0 z-50 w-[280px] sm:w-80 max-h-[calc(100vh-100px)] sm:max-h-none bg-white rounded-3xl sm:rounded-none sm:rounded-l-3xl shadow-[0_10px_40px_-5px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden border border-gray-100 sm:border-none"
              >
                <div className="p-4 sm:p-5 flex items-center justify-between border-b border-gray-100">
                  <span className="font-black text-lg sm:text-xl text-[#0B192C]">Menu</span>
                  <button 
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-95 bg-gray-50 sm:bg-transparent"
                  >
                    <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto py-2 sm:py-4">
                  <div className="px-2 sm:px-3 flex flex-col gap-1">
                    <button 
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setIsTrackingModalOpen(true);
                      }}
                      className="w-full flex items-center gap-3 p-3 sm:p-4 rounded-2xl hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[#0B192C]/5 flex items-center justify-center flex-shrink-0">
                        <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[#0B192C]" />
                      </div>
                      <div>
                        <div className="font-bold text-[#0B192C] text-sm sm:text-base">Cek Status Pesanan</div>
                        <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Lacak progres orderan Anda</div>
                      </div>
                    </button>
                    <button 
                      onClick={() => { setIsMobileMenuOpen(false); document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' }); }}
                      className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-blue-50 transition-colors text-left font-bold text-[#0B192C] text-[15px]"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#F4F6F8] flex items-center justify-center shrink-0">
                         <ShoppingCart className="w-4 h-4 text-[#FFA800]" /> 
                      </div>
                      Layanan
                    </button>
                    <button 
                      onClick={() => { setIsMobileMenuOpen(false); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }}
                      className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-blue-50 transition-colors text-left font-bold text-[#0B192C] text-[15px]"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#F4F6F8] flex items-center justify-center shrink-0">
                         <Check className="w-4 h-4 text-[#FFA800]" /> 
                      </div>
                      Keunggulan
                    </button>
                    <button 
                      onClick={() => { setIsMobileMenuOpen(false); openWhatsAppGeneral(); }}
                      className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-blue-50 transition-colors text-left font-bold text-[#0B192C] text-[15px]"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#F4F6F8] flex items-center justify-center shrink-0">
                         <Phone className="w-4 h-4 text-[#FFA800]" /> 
                      </div>
                      Chat CS
                    </button>
                  </div>
                  
                  <div className="mt-4 sm:mt-8 px-4 sm:px-5">
                    <h4 className="text-[#A0ABBA] text-[10px] font-bold uppercase tracking-widest mb-2 sm:mb-3">Wilayah Tersedia</h4>
                    <div className="flex flex-col gap-2.5">
                      {['Makassar', 'Gowa', 'Maros'].map((area, i) => (
                        <div key={i} className="flex items-center gap-2 text-[13px] text-gray-600 font-medium">
                            <MapPin className="w-3.5 h-3.5 text-[#FFA800]" /> {area}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="p-3 sm:p-5 border-t border-gray-100 bg-gray-50/50 mt-auto">
                  <button 
                      onClick={() => { setIsMobileMenuOpen(false); document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' }); }}
                      className="w-full bg-[#0B192C] hover:bg-[#11233E] text-white font-bold py-3.5 sm:py-4 rounded-xl sm:rounded-2xl shadow-lg transition-all active:scale-95 text-[15px]"
                  >
                      Pesan Sekarang
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Hero Section */}
        <main className="px-5 pt-12 lg:pt-20 max-w-7xl mx-auto flex flex-col lg:flex-row-reverse lg:items-center gap-16 lg:gap-12">
          {/* Visual Card */}
          <div className="w-full lg:w-1/2 flex flex-col items-center relative">
            <div className="w-full max-w-sm sm:max-w-md lg:max-w-lg relative z-10">
               <div className="absolute -top-5 -right-3 sm:-right-5 z-30 bg-[#FFA800] rounded-2xl px-3 py-2 flex flex-col items-center justify-center shadow-lg transform rotate-6 border-2 border-[#0B192C]">
                 <span className="text-[10px] font-bold text-[#0B192C] uppercase leading-none">Dingin</span>
                 <span className="text-xl sm:text-2xl font-black text-[#0B192C] leading-tight mt-0.5">18°C</span>
               </div>
               
               <motion.div 
                 whileTap={{ scale: 0.98 }}
                 onClick={handleACClick}
                 className="bg-white rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 min-h-[140px] sm:min-h-[180px] shadow-2xl relative overflow-hidden z-20 w-full transform -rotate-2 cursor-pointer transition-shadow hover:shadow-blue-500/10"
               >
                  {/* Snowflakes for click effect */}
                  <AnimatePresence>
                    {snowflakes.map(s => (
                      <motion.div
                        key={s.id}
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 200, opacity: [0, 1, 1, 0], x: [0, (Math.random() - 0.5) * 50] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 2, ease: "linear", delay: s.startDelay }}
                        className="absolute top-0 pointer-events-none text-blue-100 z-0"
                        style={{ left: `${s.left}%` }}
                      >
                        <Snowflake size={s.size} strokeWidth={1} />
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  <div className="flex justify-between items-center mb-8 relative z-10">
                     <span className="font-bold text-xs sm:text-sm tracking-widest text-[#0B192C]">JAGO AC</span>
                     <div className="flex items-center space-x-1.5 sm:space-x-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                        <span className="text-[10px] sm:text-xs text-[#A0ABBA] font-bold uppercase tracking-wider">COOL</span>
                     </div>
                  </div>
                  
                  <div className="space-y-3 sm:space-y-4 opacity-10">
                     <div className="h-2.5 bg-[#0B192C] rounded-full w-full"></div>
                     <div className="h-2.5 bg-[#0B192C] rounded-full w-full"></div>
                     <div className="h-2.5 bg-[#0B192C] rounded-full w-full"></div>
                     <div className="h-2.5 bg-[#0B192C] rounded-full w-3/4"></div>
                  </div>
               </motion.div>

               {/* Add connection lines */}
               <div className="absolute -bottom-8 sm:-bottom-12 left-0 right-0 px-12 sm:px-16 flex justify-between z-10">
                  <div className="w-1.5 h-12 sm:h-20 bg-white/20 rounded-full"></div>
                  <div className="w-1.5 h-12 sm:h-20 bg-white/20 rounded-full"></div>
                  <div className="w-1.5 h-12 sm:h-20 bg-white/20 rounded-full"></div>
               </div>
            </div>

            {/* Floating Callout */}
            <motion.div 
              style={{
                y: useTransform(useScroll().scrollYProgress, [0, 1], [0, 20]),
                rotate: useTransform(useScroll().scrollYProgress, [0, 0.5], [1, -2])
              }}
              whileHover={{ scale: 1.02, rotate: 0 }}
              className="bg-white rounded-3xl relative mt-3 sm:mt-6 p-6 sm:p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] z-20 max-w-xs sm:max-w-sm lg:max-w-md w-full"
            >
               <p className="text-xs sm:text-sm text-gray-500 font-bold tracking-wider uppercase mb-1">Cuci AC mulai</p>
               <div className="flex flex-col my-1">
                 <div className="flex items-center space-x-2">
                   <span className="text-base sm:text-lg font-bold text-gray-400 line-through">Rp 75.000</span>
                 </div>
                 <div className="flex items-center space-x-3 mt-1">
                   <Snowflake className="w-8 h-8 text-[#FFA800]" />
                   <h3 className="text-3xl sm:text-4xl font-black text-[#0B192C] tracking-tight">Rp 70.000</h3>
                 </div>
               </div>
               <p className="text-xs sm:text-sm text-gray-500 font-medium mt-3 leading-relaxed">Sudah termasuk teknisi datang, steam, & deterjen.</p>
            </motion.div>
          </div>

          {/* Hero Text */}
          <div className="w-full lg:w-1/2 pt-8 lg:pt-0">
             <div className="flex flex-wrap items-center gap-2 mb-6">
               <span className="bg-[#FFA800] text-[#0B192C] text-[10px] sm:text-xs font-bold px-3 py-1.5 rounded-md tracking-wider uppercase shadow-sm">Jagonya Bikin Dingin</span>
               <span className="bg-white/10 text-white border border-white/20 text-[10px] sm:text-xs font-medium px-3 py-1.5 rounded-md uppercase tracking-wider">Makassar · Gowa · Maros</span>
             </div>
             
             <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight">
               AC Anda<br/>Bau & Tidak <span className="text-[#0B192C] relative inline-block bg-[#FFA800] px-3 pb-1 mt-2 transform -rotate-2 rounded-xl shadow-lg">Dingin</span>?
             </h1>
             
             <p className="text-blue-100/90 mt-6 sm:mt-8 text-base lg:text-lg leading-relaxed max-w-lg">
               Serahkan ke <span className="font-bold text-white">JAGO AC</span> — teknisi berpengalaman, peralatan steam profesional, hasil bersih maksimal. Mulai dari <span className="font-bold text-gray-400 line-through text-sm mx-1">Rp 75.000</span> <span className="font-bold text-[#FFA800] text-xl">Rp 70.000</span> saja per unit.
             </p>

             <div className="mt-10 flex flex-col sm:flex-row gap-4">
               <button 
                  onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-[#FFA800] hover:bg-white text-[#0B192C] font-bold text-lg py-4 px-8 rounded-full shadow-lg hover:shadow-[0_0_30px_rgba(255,168,0,0.5)] flex items-center justify-center gap-2 active:scale-[0.98] transition-all group"
               >
                  <span>Pesan Cuci AC</span>
                  <span className="text-xl leading-none group-hover:translate-x-2 transition-transform">&rarr;</span>
               </button>
               <button 
                  onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-transparent border-2 border-white/30 hover:border-white hover:bg-white/10 text-white font-semibold text-base py-4 px-8 rounded-full active:scale-[0.98] transition-all"
               >
                  Lihat Keunggulan
               </button>
             </div>
             
             <div className="mt-10 flex flex-wrap gap-y-4 gap-x-6 sm:gap-8 px-2 max-w-2xl">
                <div className="flex items-center gap-2 text-white">
                   <Check className="w-5 h-5 text-green-400 stroke-[3]" />
                   <span className="text-sm font-semibold tracking-wide">Garansi 7 Hari</span>
                </div>
                <div className="flex items-center gap-2 text-white">
                   <Check className="w-5 h-5 text-green-400 stroke-[3]" />
                   <span className="text-sm font-semibold tracking-wide">Teknisi Profesional</span>
                </div>
                <div className="flex items-center gap-2 text-white">
                   <Check className="w-5 h-5 text-green-400 stroke-[3]" />
                   <span className="text-sm font-semibold tracking-wide">Biaya Transparan</span>
                </div>
                <div className="flex items-center gap-2 text-white">
                   <Check className="w-5 h-5 text-green-400 stroke-[3]" />
                   <span className="text-sm font-semibold tracking-wide">Pesan Hari Ini, Dicuci Hari Ini</span>
                </div>
             </div>
             
             <div className="mt-8 flex items-center justify-start gap-3 px-2">
                 <div className="flex text-[#FFB000]">
                    {[...Array(5)].map((_, i) => <Star key={i} className="w-5 h-5 fill-current" />)}
                 </div>
                 <span className="text-sm font-semibold text-white tracking-wide">4.9/5 <span className="text-blue-200/80 font-normal ml-1">(500+ pelanggan)</span></span>
             </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-[#0B192C] text-white py-12 px-5 mt-20">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="text-center md:text-left">
              <h2 className="text-2xl font-black text-[#FFA800] tracking-tighter">JAGO AC</h2>
              <p className="text-blue-200 mt-2 text-sm max-w-xs">Solusi Jasa AC Profesional & Terpercaya di Makassar, Gowa, dan Maros.</p>
            </div>
            
            <div className="flex flex-col items-center md:items-end gap-3 uppercase tracking-widest font-black text-[10px] text-gray-400">
               <div className="flex gap-6">
                 <a href="#services" onClick={(e) => { e.preventDefault(); document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' }); }} className="hover:text-[#FFA800] transition-colors cursor-pointer">Layanan</a>
                 <a href="/teknisi" className="text-[#FFA800] hover:brightness-110 transition-colors border border-[#FFA800]/30 px-3 py-1 rounded-full">Portal Teknisi</a>
               </div>
               <p className="mt-4">© 2026 JAGO AC. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>

      {/* How it works Section */}
      <section className="px-5 py-14 sm:py-20 bg-white relative">
        <h4 className="text-[10px] sm:text-xs font-bold tracking-widest text-[#0B192C] text-center uppercase mb-3">Cara Kerja</h4>
        <h2 className="text-3xl sm:text-4xl text-center text-[#0B192C] font-black tracking-tight leading-[1.1] mb-12 sm:mb-16">4 Langkah Mudah <br/><span className="text-[#FFA800]">Pesan JAGO AC</span></h2>
        
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-4 max-w-5xl mx-auto relative px-2">
           <div className="hidden sm:block absolute top-[28px] left-[10%] right-[10%] h-[2px] bg-gray-100 -z-10"></div>
           {[
             { title: 'Pilih Layanan', desc: 'Pilih layanan cuci, freon, atau perbaikan AC yang Anda butuhkan.' },
             { title: 'Isi Data Diri', desc: 'Lengkapi form pemesanan dengan alamat rumah dan tentukan waktu yang diinginkan.' },
             { title: 'Teknisi Datang', desc: 'Tim JAGO AC akan datang ke lokasi Anda membawa perlengkapan servis profesional.' },
             { title: 'AC Dingin & Bayar', desc: 'Cek kondisi AC Anda. Setelah benar-benar dingin, baru bayar.' },
           ].map((step, i) => (
              <div key={i} className="flex-1 flex flex-row sm:flex-col items-center sm:text-center gap-4 sm:gap-6 bg-[#FCFBF8] sm:bg-transparent p-5 sm:p-0 rounded-2xl sm:rounded-none">
                 <div className="w-14 h-14 bg-[#0B192C] text-white rounded-full flex items-center justify-center font-black text-xl shadow-lg ring-4 ring-white shrink-0 z-10 transition-transform hover:scale-110">
                    {i + 1}
                 </div>
                 <div>
                    <h3 className="font-bold text-[#0B192C] text-[17px] mb-1.5">{step.title}</h3>
                    <p className="text-[13.5px] text-gray-500 leading-relaxed font-medium">{step.desc}</p>
                 </div>
              </div>
           ))}
        </div>
      </section>

      {/* Services List Section */}
      <section id="services" ref={servicesRef} className="mt-14 pt-10 pb-32 px-4 border-t border-gray-100 bg-white relative">
        <div className="flex items-center gap-2 mb-3 justify-center text-[#0B192C]">
           <ShoppingCart className="w-5 h-5 opacity-50" />
        </div>
        <h2 className="text-[32px] text-center text-[#0B192C] font-black tracking-tight leading-none mb-3">Pilih Layanan Anda</h2>
        <p className="text-gray-500 text-center text-[15px] mb-8 max-w-xs mx-auto">Tekan tombol <span className="font-bold text-[#FFA800]">+</span> untuk menambah layanan ke pesanan Anda.</p>

        <div className="space-y-4">
           {dynamicServices.map((svc) => (
             <div key={svc.id} className="bg-white border border-gray-100 hover:border-[#FFA800]/50 hover:shadow-md transition-all duration-300 rounded-3xl p-5 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] cursor-default">
                <div className="flex gap-4 items-start">
                   <div className="w-12 h-12 rounded-2xl bg-[#F4F6F8] flex items-center justify-center text-[#0B192C] shrink-0 transition-transform hover:scale-110 duration-300">
                      <svc.icon className="w-6 h-6 stroke-[1.5]" />
                   </div>
                   <div className="flex-1 pt-1">
                      <h4 className="font-bold text-[#0B192C] text-[17px] leading-tight">{svc.name}</h4>
                      <p className="text-[13px] text-gray-500 mt-1 leading-relaxed">{svc.desc}</p>
                      <p className="font-semibold text-[#0B192C] mt-3 text-[15px]">{formatCurrency(svc.price)}<span className="text-xs font-normal text-gray-400">/unit</span></p>
                   </div>
                   <div className="flex items-start pt-1 shrink-0">
                      {!cart[svc.id] ? (
                         <div className="flex items-center rounded-xl bg-[#F4F6F8] p-1 h-10 w-24 transition-colors hover:bg-gray-100">
                           <button className="w-8 h-8 flex items-center justify-center text-gray-300 pointer-events-none transition-colors">
                              <Minus className="w-4 h-4" />
                           </button>
                           <span className="flex-1 text-center font-bold text-[#0B192C] text-sm">0</span>
                           <button onClick={() => updateQuantity(svc.id, 1)} className="w-8 h-8 rounded-lg bg-[#FFA800] hover:bg-[#0B192C] hover:text-[#FFA800] flex items-center justify-center text-[#0B192C] active:scale-90 transition-all shadow-sm">
                              <Plus className="w-4 h-4 stroke-[3]" />
                           </button>
                         </div>
                      ) : (
                         <div className="flex items-center rounded-xl bg-[#F4F6F8] p-1 h-10 w-24 border border-gray-200">
                           <button onClick={() => updateQuantity(svc.id, -1)} className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-50 rounded-lg text-gray-600 shadow-sm active:scale-90 transition-all">
                              <Minus className="w-4 h-4" />
                           </button>
                           <span className="flex-1 text-center font-bold text-[#0B192C] text-sm">{cart[svc.id]}</span>
                           <button onClick={() => updateQuantity(svc.id, 1)} className="w-8 h-8 rounded-lg bg-[#FFA800] hover:bg-[#0B192C] hover:text-[#FFA800] flex items-center justify-center text-[#0B192C] shadow-sm active:scale-90 transition-all">
                              <Plus className="w-4 h-4 stroke-[3]" />
                           </button>
                         </div>
                      )}
                   </div>
                </div>
             </div>
           ))}
        </div>

        {/* Bottom Floating Bar */}
        <div 
           className={`left-0 w-full z-40 px-4 ptr-safe pt-2 pointer-events-none transition-all duration-300 ${
             cartPosition === 'hidden' ? 'opacity-0 translate-y-10' : 'opacity-100 translate-y-0'
           } ${cartPosition === 'fixed' ? 'fixed bottom-0 pb-4 bg-gradient-to-t from-[#FCFBF8] to-transparent' : 'absolute bottom-4'}`}
        >
           <div className={`bg-[#0B192C] rounded-[24px] p-4 flex justify-between items-center shadow-2xl max-w-2xl mx-auto ${cartPosition === 'hidden' ? 'pointer-events-none' : 'pointer-events-auto'}`}>
              <div className="pl-2">
                 <p className="text-[#A0ABBA] text-[9px] font-bold uppercase tracking-widest mb-1">
                    {totalItems > 0 ? 'Layanan Dipilih' : 'Belum Ada Layanan'}
                 </p>
                 <p className="text-xl font-black text-white leading-none">
                    Rp {totalPrice > 0 ? new Intl.NumberFormat('id-ID').format(totalPrice) : '0'}
                 </p>
              </div>
              
              <button 
                 onClick={() => setIsCheckoutOpen(true)}
                 disabled={totalItems === 0}
                 className={`flex items-center gap-2 px-6 py-3.5 rounded-[18px] font-bold text-sm transition-all duration-300 ${
                    totalItems > 0 
                    ? 'bg-transparent text-[#0B192C] relative overflow-hidden group hover:scale-[1.02] active:scale-95 hover:shadow-lg shadow-[#0B192C]/50' 
                    : 'bg-white/10 text-white/30 cursor-not-allowed'
                 }`}
              >
                 {totalItems > 0 && <div className="absolute inset-0 bg-[#FFA800] group-hover:bg-white transition-colors z-0"></div>}
                 <span className="relative z-10 flex items-center gap-2 group-hover:text-[#0B192C]">
                   <ShoppingCart className="w-4 h-4" /> 
                   Checkout
                 </span>
              </button>
           </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="px-5 py-14 bg-[#FCFBF8]">
        <h4 className="text-[10px] font-bold tracking-widest text-[#0B192C] uppercase mb-3">Kenapa JAGO AC?</h4>
        <h2 className="text-[32px] font-black text-[#0B192C] leading-[1.1] mb-4">Servis cepat, bersih, dan dijamin puas.</h2>
        <p className="text-gray-500 text-[15px] mb-8 leading-relaxed">Lebih dari 500 pelanggan di Sulsel telah mempercayakan AC mereka pada teknisi kami.</p>

        <div className="flex flex-col gap-4">
           {/* Card 1 */}
           <div className="bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
              <div className="w-12 h-12 bg-[#0B192C] rounded-2xl flex items-center justify-center text-white mb-5 shadow-sm">
                 <Check className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="font-bold text-[#0B192C] text-lg mb-1">Garansi 7 Hari</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Jika AC tidak dingin atau bocor air dalam 7 hari pasca servis, kami cuci ulang GRATIS.</p>
            </div>
            
            {/* Card 4 */}
            <div className="bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
              <div className="w-12 h-12 bg-[#0B192C] rounded-2xl flex items-center justify-center text-white mb-5 shadow-sm">
                <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="font-bold text-[#0B192C] text-lg mb-1">Ruangan Tetap Rapi</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Kami gunakan plastik pelindung lebar. Furniture dan lantai Anda dijamin tetap bersih & kering.</p>
           </div>
           
           {/* Card 2 */}
           <div className="bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
              <div className="w-12 h-12 bg-[#0B192C] rounded-2xl flex items-center justify-center text-white mb-5 shadow-sm">
                 <Wrench className="w-6 h-6 stroke-[2]" />
              </div>
              <h3 className="font-bold text-[#0B192C] text-lg mb-1">Teknisi Berpengalaman</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Tim bersertifikat, peralatan steam profesional, paham betul masalah AC.</p>
           </div>

           {/* Card 3 */}
           <div className="bg-white border border-gray-100 p-6 rounded-3xl shadow-sm">
              <div className="w-12 h-12 bg-[#0B192C] rounded-2xl flex items-center justify-center text-white mb-5 shadow-sm">
                 <svg className="w-6 h-6 stroke-[2] fill-none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="font-bold text-[#0B192C] text-lg mb-1">Harga Transparan</h3>
              <p className="text-gray-500 text-sm leading-relaxed">Tanpa biaya tambahan tersembunyi. Bayar setelah seluruh pekerjaan selesai.</p>
           </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-14 bg-[#FCFBF8]">
         <div className="text-center mb-8 px-5">
            <div className="flex justify-center text-[#FFA800] mb-2">
               <Star className="w-5 h-5 fill-current" />
            </div>
            <h4 className="text-[10px] font-bold tracking-widest text-[#0B192C] uppercase mb-2">Testimoni Pelanggan</h4>
            <h2 className="text-[32px] font-black text-[#0B192C] leading-tight">Kata Mereka yang <br/><span className="text-[#FFA800]">Sudah Coba</span></h2>
         </div>

         <div 
           className="flex overflow-x-auto gap-4 px-5 pb-8 snap-x snap-mandatory"
           style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
         >
           <style dangerouslySetInnerHTML={{__html: `
              .hide-scrollbar::-webkit-scrollbar { display: none; }
           `}} />
            
            {/* Testimonial 1 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Pelayanan super cepat! Pesan pagi, siang teknisi sudah datang. AC di kamar sekarang dingin banget sampai menggigil. Mantap JAGO AC!"</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Pak Budi</p>
                 <p className="text-xs text-gray-500 mt-0.5">Jl. Perintis Kemerdekaan, Makassar</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>

            {/* Testimonial 2 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Sangat profesional. Teknisi menjelaskan detail masalah AC saya sebelum dicuci. Hasilnya memuaskan dan harga jujur, tidak ada biaya tersembunyi."</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Ibu Rahma</p>
                 <p className="text-xs text-gray-500 mt-0.5">Jl. Sultan Hasanuddin, Gowa</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>

            {/* Testimonial 3 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Dua AC rumah dicuci tuntas. Air kotornya banyak banget pas didemo, baru sadar AC ku jorok. Sekarang dingin lagi!"</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Mbak Dini</p>
                 <p className="text-xs text-gray-500 mt-0.5">Jl. Jenderal Sudirman, Maros</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>

            {/* Testimonial 4 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Teknisinya ramah dan kerjanya rapi banget. AC kamar yang tadinya bunyi sekarang adem & senyap. Pasti pakai JAGO AC lagi!"</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Bu Arini</p>
                 <p className="text-xs text-gray-500 mt-0.5">Jl. Boulevard Panakkukang, Makassar</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>

            {/* Testimonial 5 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Baru kali ini nemu jasa cuci AC yang kerjanya teliti sampai ke sela-sela. Semprotan airnya kencang, kotoran bandel hilang semua."</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Pak Andi</p>
                 <p className="text-xs text-gray-500 mt-0.5">BTP Raya, Makassar</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>

            {/* Testimonial 6 */}
            <div className="min-w-[280px] sm:min-w-[320px] max-w-[320px] bg-white border border-gray-100 p-6 rounded-3xl shadow-sm relative snap-center flex flex-col justify-between hide-scrollbar">
               <div>
                 <div className="flex text-[#FFA800] mb-4">
                   {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                 </div>
                 <p className="text-gray-700 leading-relaxed text-[15px] italic mb-6 relative z-10">"Sangat rekomendasi untuk wilayah Gowa. Tepat waktu dan hasil cuciannya bikin AC seperti baru keluar dari toko. Terima kasih JAGO AC."</p>
               </div>
               <div className="mt-auto relative z-10">
                 <p className="font-bold text-[#0B192C]">Mas Fadil</p>
                 <p className="text-xs text-gray-500 mt-0.5">Jl. Poros Pallangga, Gowa</p>
               </div>
               <span className="absolute top-6 right-6 text-6xl text-gray-100 font-serif leading-none z-0">"</span>
            </div>
         </div>

         <div className="mt-2 flex gap-4 px-5">
            <div className="flex-1 bg-[#0B192C] rounded-2xl p-4 text-center">
               <h4 className="text-[28px] font-black text-[#FFA800]">500+</h4>
               <p className="text-xs text-blue-200 mt-1">Pelanggan Puas</p>
            </div>
            <div className="flex-1 bg-[#0B192C] rounded-2xl p-4 text-center">
               <h4 className="text-[28px] font-black text-[#FFA800] flex items-center justify-center gap-1">4.9<Star className="w-5 h-5 fill-current" /></h4>
               <p className="text-xs text-blue-200 mt-1">Rating Rata-rata</p>
            </div>
         </div>
      </section>

      {/* FAQ Section */}
      <section className="py-14 px-5 bg-white border-t border-gray-100">
         <div className="text-center mb-10">
            <h4 className="text-[10px] font-bold tracking-widest text-[#0B192C] uppercase mb-2">Pertanyaan Umum</h4>
            <h2 className="text-[32px] font-black text-[#0B192C] leading-tight">Hal yang Sering <br/><span className="text-[#FFA800]">Ditanyakan</span></h2>
         </div>

         <div className="border border-gray-200 rounded-3xl overflow-hidden divide-y divide-gray-100">
            {[
               { q: 'Berapa lama proses cuci AC 1 unit?', a: 'Standarnya memakan waktu 45-60 menit tergantung tingkat kekotoran AC.' },
               { q: 'Apakah saya perlu menyiapkan tangga atau ember?', a: 'Tidak perlu. Tim JAGO AC membawa peralatan lengkap sendiri termasuk tangga lipat, ember, dan plastik pelindung AC.' },
               { q: 'Bagaimana jika AC masih tetap tidak dingin?', a: 'Kami memberikan Garansi 7 Hari. Jika dalam kurun waktu tersebut AC tidak dingin atau bocor air, kami akan datang kembali untuk pengecekan ulang tanpa biaya.' },
               { q: 'Apa yang perlu saya siapkan di rumah?', a: 'Kami hanya membutuhkan akses keran air dan colokan listrik di area pengerjaan AC Anda.' },
               { q: 'Bagaimana cara pembayarannya?', a: 'Pembayaran sangat fleksibel. Bisa tunai ke teknisi, Transfer Bank, atau QRIS setelah pengerjaan selesai 100%.' },
               { q: 'Apakah ada biaya transportasi tambahan?', a: 'Untuk wilayah Makassar, Gowa, dan Maros (area jangkauan standar), tidak ada biaya transportasi tambahan. Harga yang tertera adalah harga final.' },
            ].map((faq, idx) => (
               <div key={idx} className="bg-white">
                  <button 
                     onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                     className="w-full px-6 py-5 flex items-center justify-between text-left focus:outline-none hover:bg-gray-50 transition-colors"
                  >
                     <span className="font-semibold text-[#0B192C] pr-4 text-[15px]">{faq.q}</span>
                     <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${openFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === idx && (
                     <div className="px-6 pb-5">
                        <p className="text-gray-500 text-sm leading-relaxed">{faq.a}</p>
                     </div>
                  )}
               </div>
            ))}
         </div>
      </section>

      {/* CTA & Footer */}
      <div className="bg-[#0B192C] text-white pt-16 pb-40 px-5 relative z-20">
         <div className="mb-12">
            <h2 className="text-[32px] font-black leading-tight mb-4">Siap bikin AC Anda <span className="text-[#FFA800]">adem</span> lagi?</h2>
            <p className="text-blue-100/80 text-[15px] leading-relaxed mb-8">Pesan sekarang & teknisi kami siap meluncur ke alamat Anda.</p>
            <div className="flex flex-col gap-4">
               <button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} className="w-full bg-[#FFA800] hover:bg-white text-[#0B192C] font-bold py-4 rounded-full shadow-lg shadow-[#FFA800]/20 active:scale-95 transition-all text-[15px]">Pesan Cuci AC</button>
               <button onClick={openWhatsAppGeneral} className="w-full bg-[#1A283C] border border-white/10 hover:border-white/30 hover:bg-white/10 text-white font-bold py-4 rounded-full active:scale-95 transition-all text-[15px]">Chat WhatsApp</button>
            </div>
         </div>

         <div className="space-y-10">
            {/* Branding */}
            <div>
               <div className="mb-4">
                  <Logo isDark={true} variant="horizontal" className="scale-110 origin-left" />
               </div>
               <p className="text-blue-100/80 text-[15px] leading-relaxed pr-4">
                  Layanan cuci AC profesional dengan teknisi berpengalaman. Bersih maksimal, harga ramah di kantong.
               </p>
            </div>

            {/* Wilayah */}
            <div>
               <h4 className="text-[#FFA800] font-bold tracking-widest text-[13px] mb-5 uppercase">Wilayah</h4>
               <ul className="space-y-4">
                  {['Makassar', 'Gowa', 'Maros'].map((area, i) => (
                     <li key={i} className="flex items-center gap-3 text-blue-100/90 text-[15px] font-medium">
                        <MapPin className="w-4 h-4 text-[#FFA800]" /> {area}
                     </li>
                  ))}
               </ul>
            </div>

            {/* Kontak */}
            <div>
               <h4 className="text-[#FFA800] font-bold tracking-widest text-[13px] mb-5 uppercase">Kontak</h4>
               <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-blue-100/90 text-[15px] font-medium">
                     <Phone className="w-4 h-4 text-[#FFA800]" />
                     <a href="https://wa.me/6285156388993" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors cursor-pointer active:scale-95 inline-block">0851 5638 8993</a>
                  </li>
                  <li className="flex items-center gap-3 text-blue-100/90 text-[15px] font-medium">
                     <Mail className="w-4 h-4 text-[#FFA800]" />
                     <a href="mailto:jagoacmks@gmail.com" className="hover:text-white transition-colors cursor-pointer active:scale-95 inline-block">jagoacmks@gmail.com</a>
                  </li>
                  <li className="flex items-center gap-3 text-blue-100/90 text-[15px] font-medium">
                     <Clock className="w-4 h-4 text-[#FFA800]" /> Setiap Hari, 09.00 - 18.00
                  </li>
               </ul>
            </div>

            {/* Menu */}
            <div>
               <h4 className="text-[#FFA800] font-bold tracking-widest text-[13px] mb-5 uppercase">Menu</h4>
               <ul className="space-y-4 text-blue-100/90 text-[15px] font-medium">
                  <li><button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-white transition-colors">Layanan</button></li>
                  <li><button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-white transition-colors">Keunggulan</button></li>
                  <li><button className="hover:text-white transition-colors">Testimoni</button></li>
                  <li><button className="hover:text-white transition-colors">FAQ</button></li>
               </ul>
            </div>
         </div>

         <div className="mt-14 pt-8 border-t border-white/10 text-center text-blue-200/50 text-[13px]">
            <p className="mb-2">© 2026 JAGO AC. Semua Hak Dilindungi.</p>
            <p className="flex items-center justify-center">Dibuat dengan <Snowflake className="w-4 h-4 inline text-white mx-1.5" /> untuk hari yang lebih adem.</p>
         </div>
      </div>

      {/* Floating WhatsApp Bubble */}
      <motion.button 
         onClick={openWhatsAppGeneral}
         initial={{ scale: 0.8, opacity: 0 }}
         animate={{ 
            scale: [1, 1.05, 1],
            rotate: [0, -5, 5, 0],
            opacity: 1
         }}
         transition={{ 
            scale: { duration: 2, repeat: Infinity, ease: "easeInOut" },
            rotate: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }
         }}
         whileHover={{ scale: 1.1 }}
         whileTap={{ scale: 0.9 }}
         className="fixed z-50 bottom-[100px] right-6 w-12 h-12 bg-[#25D366] text-white rounded-full flex items-center justify-center shadow-lg shadow-green-500/40 border-2 border-white"
      >
         <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-20"></div>
         <MessageCircle className="w-6 h-6 relative z-10" />
      </motion.button>

      {/* Checkout Modal / Drawer */}
      <AnimatePresence>
         {isCheckoutOpen && (
            <>
               <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsCheckoutOpen(false)}
                  className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm"
               />
               <motion.form 
                  id="checkoutForm"
                  onSubmit={submitCheckout}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="fixed bottom-0 left-0 w-full h-[90vh] bg-[#FCFBF8] z-[70] rounded-t-3xl flex flex-col shadow-2xl overflow-hidden"
               >
                  {/* Header */}
                  <div className="bg-[#0B192C] text-white px-5 py-6">
                     <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                           <ShieldCheck className="w-6 h-6 text-[#FFA800]" />
                           <h2 className="text-xl font-bold tracking-tight">Konfirmasi Pesanan</h2>
                        </div>
                        <button onClick={() => setIsCheckoutOpen(false)} className="text-white/70 hover:text-white bg-white/10 p-1.5 rounded-full">
                           <X className="w-5 h-5" />
                        </button>
                     </div>
                     <p className="text-sm text-blue-100/80 leading-relaxed font-medium">Periksa pesanan, pilih jadwal, & isi data. Pesanan akan tersimpan & dikirim ke WhatsApp JAGO AC.</p>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
                     {/* Order Summary */}
                     <div>
                        <div className="flex items-center gap-2 text-[#0B192C] mb-4">
                           <div className="w-5 h-5 border border-current rounded flex items-center justify-center text-[10px] font-bold">$</div>
                           <h3 className="font-bold uppercase tracking-widest text-xs">Ringkasan Pesanan</h3>
                        </div>
                        <div className="space-y-3 font-medium text-sm text-[#0B192C]">
                           {Object.entries(cart).map(([id, qty]) => {
                              const service = dynamicServices.find(s => s.id === Number(id));
                              if (!service) return null;
                              return (
                                 <div key={id} className="flex justify-between items-center">
                                    <span className="text-gray-600">{service.name} <span className="text-gray-400">×{qty}</span></span>
                                    <span>{formatCurrency(service.price * Number(qty))}</span>
                                 </div>
                              );
                           })}
                           <div className="pt-3 border-t border-gray-200/60 flex justify-between items-center">
                              <span className="text-gray-500">Subtotal</span>
                              <span>{formatCurrency(subTotal)}</span>
                           </div>
                           {appliedPromo && (
                              <div className="flex justify-between items-center text-green-600">
                                 <span>Promo ({appliedPromo.code})</span>
                                 <span>-{formatCurrency(appliedPromo.discount)}</span>
                              </div>
                           )}
                           <div className="pt-3 border-t border-gray-200/60 flex justify-between items-center text-lg font-black pt-2">
                              <span>Total</span>
                              <span>{formatCurrency(totalPrice)}</span>
                           </div>
                        </div>
                     </div>

                     {/* Promo */}
                     <div>
                        <h3 className="font-bold uppercase tracking-widest text-[#0B192C] text-xs mb-3">Kode Promo (Opsional)</h3>
                        <div className="flex gap-2">
                           <input 
                              type="text" 
                              value={promoCode}
                              onChange={(e) => setPromoCode(e.target.value)}
                              placeholder={`CTH: ${activePromos && activePromos.length > 0 ? activePromos[0].id : 'HEMAT10'}`} 
                              className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] focus:border-transparent uppercase font-medium placeholder:normal-case placeholder:font-normal uppercase"
                           />
                           <button 
                              type="button"
                              onClick={handleApplyPromo}
                              className="bg-[#A0ABBA] hover:bg-[#0B192C] text-white hover:text-[#FFA800] px-5 rounded-xl font-bold text-sm transition-all active:scale-95"
                           >Terapkan</button>
                        </div>
                        {activePromos && activePromos.length > 0 && (
                          <p className="text-[11px] text-gray-500 mt-2">Coba: {activePromos[0].id} (Diskon {formatCurrency(activePromos[0].discount)})</p>
                        )}
                     </div>

                     {/* Form */}
                     <div className="space-y-5 pb-4">
                        <div className="flex gap-4">
                           <div className="flex-1">
                              <label className="flex items-center gap-1.5 text-sm font-semibold text-[#0B192C] mb-2"><Calendar className="w-4 h-4"/> Tanggal <span className="text-red-500">*</span></label>
                              <div className="relative">
                                 <input type="date" required value={formData.tanggal} onChange={(e) => setFormData({...formData, tanggal: e.target.value})} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] appearance-none"/>
                              </div>
                           </div>
                           <div className="flex-1">
                              <label className="flex items-center gap-1.5 text-sm font-semibold text-[#0B192C] mb-2"><Clock className="w-4 h-4"/> Jam <span className="text-red-500">*</span></label>
                              <div className="relative">
                                 <select required value={formData.jam} onChange={(e) => setFormData({...formData, jam: e.target.value})} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] appearance-none">
                                    <option value="" disabled>Pilih Waktu</option>
                                    <option value="09:00 WITA">09:00 WITA</option>
                                    <option value="11:00 WITA">11:00 WITA</option>
                                    <option value="13:00 WITA">13:00 WITA</option>
                                    <option value="15:00 WITA">15:00 WITA</option>
                                    <option value="17:00 WITA">17:00 WITA</option>
                                 </select>
                                 <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
                              </div>
                           </div>
                        </div>

                        <div>
                           <label className="block text-sm font-semibold text-[#0B192C] mb-2">Nama Lengkap <span className="text-red-500">*</span></label>
                           <input type="text" required value={formData.nama} onChange={(e) => setFormData({...formData, nama: e.target.value})} placeholder="cth: Andi Wijaya" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800]"/>
                        </div>

                        <div>
                           <label className="block text-sm font-semibold text-[#0B192C] mb-2">No. WhatsApp / HP <span className="text-red-500">*</span></label>
                           <input type="tel" required value={formData.nohp} onChange={(e) => setFormData({...formData, nohp: e.target.value})} placeholder="cth: 081234567890" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800]"/>
                        </div>

                        <div>
                           <label className="block text-sm font-semibold text-[#0B192C] mb-2">Wilayah <span className="text-red-500">*</span></label>
                           <div className="relative">
                              <select required value={formData.wilayah} onChange={(e) => setFormData({...formData, wilayah: e.target.value})} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] appearance-none text-gray-700">
                                 <option value="" disabled>Pilih kota Anda</option>
                                 <option value="Makassar">Makassar</option>
                                 <option value="Gowa">Gowa</option>
                                 <option value="Maros">Maros</option>
                              </select>
                              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"/>
                           </div>
                        </div>

                        <div>
                           <label className="block text-sm font-semibold text-[#0B192C] mb-2">Alamat Lengkap <span className="text-red-500">*</span></label>
                           <textarea required value={formData.alamat} onChange={(e) => setFormData({...formData, alamat: e.target.value})} placeholder="Jl. ..., No. ..., Kelurahan/Kecamatan, Patokan rumah" rows={3} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] resize-none"></textarea>
                        </div>

                        <div>
                           <label className="block text-sm font-semibold text-[#0B192C] mb-2">Catatan (opsional)</label>
                           <textarea value={formData.catatan} onChange={(e) => setFormData({...formData, catatan: e.target.value})} placeholder="cth: AC kamar utama bocor air, mohon dicek" rows={2} className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFA800] resize-none"></textarea>
                        </div>
                     </div>
                  </div>
                  
                  {/* Footer Modal */}
                  <div className="bg-white border-t border-gray-100 p-5 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] text-center relative z-10 shrink-0">
                     <p className="text-[11px] text-gray-500 mb-3 text-left leading-relaxed">Pesanan tersimpan otomatis, lalu Anda diarahkan ke WhatsApp <span className="font-bold text-[#0B192C]">{phoneNumber}</span></p>
                     <button type="submit" className="w-full bg-[#FFA800] hover:bg-[#0B192C] text-[#0B192C] hover:text-[#FFA800] font-bold py-4 rounded-xl shadow-lg hover:shadow-xl hover:shadow-[#0B192C]/20 shadow-[#FFA800]/20 flex items-center justify-center gap-2 active:scale-95 transition-all group overflow-hidden relative">
                        <span className="absolute inset-0 bg-white/20 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] skew-x-12"></span>
                        <MessageCircle className="w-5 h-5 group-hover:scale-110 transition-transform relative z-10"/>
                        <span className="relative z-10">Pesan via WhatsApp</span>
                     </button>
                  </div>
               </motion.form>
            </>
         )}

         {/* Tracking Modal */}
         {isTrackingModalOpen && (
            <>
               <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="fixed inset-0 z-50 bg-[#0B192C]/60 backdrop-blur-[2px]"
                 onClick={() => setIsTrackingModalOpen(false)}
               />
               
               <motion.div 
                 initial={{ y: '100%' }}
                 animate={{ y: 0 }}
                 exit={{ y: '100%' }}
                 transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                 className="fixed bottom-0 left-0 right-0 sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:right-auto sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-full sm:w-[500px] h-[85vh] sm:h-auto max-h-[90vh] bg-[#F4F6F8] rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col overflow-hidden"
               >
                  <div className="flex items-center justify-between p-5 border-b border-gray-200 bg-white shadow-sm shrink-0">
                     <h3 className="text-xl font-black text-[#0B192C] tracking-tight">Status Pesanan</h3>
                     <button onClick={() => setIsTrackingModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-95 bg-gray-50">
                        <X className="w-5 h-5 text-gray-500" />
                     </button>
                  </div>

                  <div className="overflow-y-auto p-5 sm:p-6 flex-1 space-y-6">
                     <form onSubmit={handleTrackOrder} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                        <label className="block text-sm font-bold text-[#0B192C] mb-2">Cek menggunakan ID Pesanan Anda</label>
                        <div className="flex gap-2">
                           <input type="text" required value={trackingId} onChange={(e) => setTrackingId(e.target.value)} placeholder="Contoh: JGO-123456" className="flex-1 border p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B192C] uppercase" />
                           <button type="submit" disabled={isTrackingLoading} className="bg-[#0B192C] text-white px-5 rounded-xl font-bold hover:bg-black transition-colors disabled:opacity-50 flex items-center justify-center">
                              {isTrackingLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                           </button>
                        </div>
                        {trackingError && <p className="text-red-500 text-sm mt-3 font-medium bg-red-50 p-3 rounded-xl border border-red-100">{trackingError}</p>}
                     </form>

                     {trackedOrders.length > 0 && (
                        <div className="space-y-4">
                           {trackedOrders.map((order, idx) => (
                              <div key={idx} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                 <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                    <div>
                                       <div className="text-xs font-bold text-gray-400 font-mono tracking-widest">{order.id}</div>
                                       <div className="font-bold text-[#0B192C] text-sm mt-0.5">{order.date} | {order.time}</div>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${order.status === 'Selesai' ? 'bg-green-100 text-green-700' : order.status === 'Sedang Dikerjakan' ? 'bg-[#FFA800]/20 text-[#0B192C]' : order.status === 'Teknisi Ditugaskan' ? 'bg-blue-100 text-blue-700' : order.status === 'Dibatalkan' ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-700'}`}>
                                       {order.status}
                                    </span>
                                 </div>
                                 <div className="p-4">
                                    {/* Progress Bar Visual */}
                                    <div className="relative pt-6 pb-2">
                                       <div className="absolute top-8 left-0 right-0 h-1 bg-gray-100 -translate-y-1/2"></div>
                                       <div className="absolute top-8 left-0 h-1 bg-[#2ECC71] -translate-y-1/2 transition-all duration-500" style={{ width: order.status === 'Selesai' ? '100%' : order.status === 'Sedang Dikerjakan' ? '66%' : order.status === 'Teknisi Ditugaskan' ? '33%' : order.status === 'Dibatalkan' ? '0%' : '5%' }}></div>
                                       
                                       <div className="flex justify-between relative z-10">
                                          <div className="flex flex-col items-center">
                                             <div className={`w-4 h-4 rounded-full flex items-center justify-center ${order.status !== 'Dibatalkan' ? 'bg-[#2ECC71]' : 'bg-gray-300'}`}></div>
                                             <span className="text-[10px] font-bold mt-2 text-gray-500 text-center w-16">Menunggu Konfirmasi</span>
                                          </div>
                                          <div className="flex flex-col items-center">
                                             <div className={`w-4 h-4 rounded-full flex items-center justify-center ${order.status === 'Teknisi Ditugaskan' || order.status === 'Sedang Dikerjakan' || order.status === 'Selesai' ? 'bg-[#2ECC71]' : 'bg-gray-200'}`}></div>
                                             <span className="text-[10px] font-bold mt-2 text-gray-500 text-center w-16">Teknisi Ditugaskan</span>
                                          </div>
                                          <div className="flex flex-col items-center">
                                             <div className={`w-4 h-4 rounded-full flex items-center justify-center ${order.status === 'Sedang Dikerjakan' || order.status === 'Selesai' ? 'bg-[#2ECC71]' : 'bg-gray-200'}`}></div>
                                             <span className="text-[10px] font-bold mt-2 text-gray-500 text-center w-16">Diproses</span>
                                          </div>
                                          <div className="flex flex-col items-center">
                                             <div className={`w-4 h-4 rounded-full flex items-center justify-center ${order.status === 'Selesai' ? 'bg-[#2ECC71]' : 'bg-gray-200'}`}></div>
                                             <span className="text-[10px] font-bold mt-2 text-gray-500 text-center w-16">Selesai</span>
                                          </div>
                                       </div>
                                    </div>
                                    
                                    {order.technician && (
                                       <div className="mt-4 bg-[#F4F6F8] p-3 rounded-xl flex items-center gap-3">
                                          <div className="w-8 h-8 bg-[#0B192C] rounded-full flex items-center justify-center">
                                             <Wrench className="w-4 h-4 text-[#FFA800]"/>
                                          </div>
                                          <div>
                                             <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Teknisi Bertugas</p>
                                             <p className="text-sm font-bold text-[#0B192C]">{order.technician}</p>
                                          </div>
                                       </div>
                                    )}
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
               </motion.div>
            </>
         )}
      </AnimatePresence>

    </div>
  );
}
